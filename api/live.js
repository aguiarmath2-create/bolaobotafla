// Vercel Serverless Function — resultados da Copa do Mundo via football-data.org
// Cache CDN (s-maxage=60): todos os usuários compartilham a mesma resposta.
// Máximo 1 chamada/min à API, independente de quantos usuários estão no site.
// Quando FINISHED, grava no Supabase para o trigger trg_compute_match_points disparar.

const FD_URL      = 'https://api.football-data.org/v4/competitions/WC/matches';
const SUPA_URL    = 'https://pmrbtugoyuwlgobovlzg.supabase.co/rest/v1/matches';
const FD_KEY      = process.env.FOOTBALL_DATA_API_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ACTIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'FINISHED']);

// Resolve placar final. Free tier não fornece placar ao vivo (fullTime fica null durante a partida).
function resolveScore(m) {
  const ft = m.score?.fullTime;
  if (ft?.home !== null && ft?.home !== undefined && ft?.away !== null && ft?.away !== undefined) {
    return { home: ft.home, away: ft.away };
  }
  const rt = m.score?.regularTime;
  if (rt?.home !== null && rt?.home !== undefined && rt?.away !== null && rt?.away !== undefined) {
    return { home: rt.home, away: rt.away };
  }
  const ht = m.score?.halfTime;
  if (ht?.home !== null && ht?.home !== undefined && ht?.away !== null && ht?.away !== undefined) {
    return { home: ht.home, away: ht.away };
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache CDN por 60 s: múltiplos usuários compartilham a mesma resposta → sem rate limit
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');

  if (!FD_KEY) {
    return res.status(500).json({ error: 'FOOTBALL_DATA_API_KEY não configurado na Vercel' });
  }

  try {
    const fdRes = await fetch(FD_URL, {
      headers: { 'X-Auth-Token': FD_KEY },
    });

    if (!fdRes.ok) {
      const text = await fdRes.text();
      return res.status(502).json({ error: `football-data.org ${fdRes.status}: ${text}` });
    }

    const { matches: allMatches } = await fdRes.json();
    const active = (allMatches || []).filter(m => ACTIVE_STATUSES.has(m.status));

    // Debug: ?debug=1 retorna dados brutos
    if (req.query?.debug === '1') {
      return res.status(200).json({
        total: allMatches?.length ?? 0,
        active: active.length,
        matches: active.map(m => ({
          id:       m.id,
          utcDate:  m.utcDate,
          status:   m.status,
          minute:   m.minute,
          homeTeam: m.homeTeam?.shortName,
          awayTeam: m.awayTeam?.shortName,
          score:    m.score,
        })),
      });
    }

    const result = [];

    for (const m of active) {
      const score = resolveScore(m);
      const mappedStatus = m.status === 'FINISHED' ? 'FINISHED'
                         : m.status === 'PAUSED'   ? 'PAUSED'
                         : 'IN_PLAY';

      result.push({
        utcDate:   m.utcDate,
        status:    mappedStatus,
        minute:    m.minute ?? null,
        homeScore: score?.home ?? null,
        awayScore: score?.away ?? null,
        homeTeam:  m.homeTeam?.name,
        awayTeam:  m.awayTeam?.name,
      });

      // Quando finalizada, aguarda a escrita no Supabase antes de retornar a resposta.
      // Assim quando o cliente receber a resposta e chamar loadData(), o DB já está atualizado
      // e a view predictions_safe já revela os palpites de todos os usuários.
      if (m.status === 'FINISHED' && score && SERVICE_KEY) {
        await supabasePatch(m.utcDate, score.home, score.away).catch(e =>
          console.error('[live] supabase patch falhou:', e.message)
        );
      }
    }

    console.log(`[live/fd] ${new Date().toISOString()} — ${result.length} partidas ativas`);
    result.forEach(r =>
      console.log(`  ${r.homeTeam} ${r.homeScore ?? '?'}-${r.awayScore ?? '?'} ${r.awayTeam} [${r.status}${r.minute ? ' ' + r.minute + '\'' : ''}]`)
    );

    return res.status(200).json({ matches: result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function supabasePatch(utcDate, homeScore, awayScore) {
  const url = `${SUPA_URL}?scheduled_at=eq.${encodeURIComponent(utcDate)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  console.log(`[live] supabase: ${utcDate} FINISHED ${homeScore}-${awayScore}`);
}
