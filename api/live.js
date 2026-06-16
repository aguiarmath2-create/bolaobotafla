// Vercel Serverless Function — live scores via football-data.org.
// Free tier não atualiza IN_PLAY durante a partida, mas atualiza FINISHED de forma confiável.
// Quando FINISHED, também grava no Supabase para o trigger trg_compute_match_points disparar.

const FD_URL      = 'https://api.football-data.org/v4/competitions/WC/matches';
const FD_KEY      = process.env.FOOTBALL_DATA_API_KEY;
const SUPA_URL    = 'https://pmrbtugoyuwlgobovlzg.supabase.co/rest/v1/matches';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FD_STATUS_MAP = {
  IN_PLAY:  'LIVE',
  PAUSED:   'LIVE',
  FINISHED: 'FINISHED',
};

// Resolve placar a partir dos campos que a API retorna.
// football-data.org free tier pode manter score.fullTime null durante IN_PLAY
// e só popular ao FINISHED. Ordem de fallback:
//   1. score.fullTime
//   2. score.regularTime
//   3. contagem do array goals[] (mais confiável ao vivo)
function resolveScore(m) {
  const ft = m.score?.fullTime;
  if (ft?.home !== null && ft?.home !== undefined && ft?.away !== null && ft?.away !== undefined) {
    return { home: ft.home, away: ft.away };
  }
  const rt = m.score?.regularTime;
  if (rt?.home !== null && rt?.home !== undefined && rt?.away !== null && rt?.away !== undefined) {
    return { home: rt.home, away: rt.away };
  }
  if (Array.isArray(m.goals)) {
    const homeId = m.homeTeam?.id;
    let home = 0, away = 0;
    for (const g of m.goals) {
      if (g.type === 'OWN_GOAL') {
        if (g.team?.id === homeId) away++; else home++;
      } else {
        if (g.team?.id === homeId) home++; else away++;
      }
    }
    return { home, away };
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (!FD_KEY) {
      return res.status(500).json({ error: 'FOOTBALL_DATA_API_KEY não configurado' });
    }

    const fdRes = await fetch(FD_URL, {
      headers: { 'X-Auth-Token': FD_KEY },
    });
    if (!fdRes.ok) {
      return res.status(fdRes.status).json({ error: `football-data.org ${fdRes.status}: ${await fdRes.text()}` });
    }

    const { matches: fdMatches } = await fdRes.json();

    // Debug: ?debug=1 retorna dados brutos
    if (req.query?.debug === '1') {
      return res.status(200).json({
        total:  fdMatches.length,
        active: fdMatches.filter(m => FD_STATUS_MAP[m.status]).length,
        matches: fdMatches.filter(m => FD_STATUS_MAP[m.status]).map(m => ({
          date:   m.utcDate,
          home:   m.homeTeam?.shortName,
          away:   m.awayTeam?.shortName,
          status: m.status,
          minute: m.minute,
          score:  m.score,
        })),
      });
    }

    const result = [];

    for (const m of fdMatches) {
      const status = FD_STATUS_MAP[m.status];
      if (!status) continue;

      const score = resolveScore(m);

      result.push({
        utcDate:   m.utcDate,
        status,
        minute:    m.minute ?? null,
        homeScore: score?.home ?? null,
        awayScore: score?.away ?? null,
        homeTeam:  m.homeTeam?.name,
        awayTeam:  m.awayTeam?.name,
      });

      // Quando FINISHED, grava no Supabase para o trigger calcular points_earned
      if (status === 'FINISHED' && SERVICE_KEY && score !== null) {
        supabasePatch(m.utcDate, score.home, score.away).catch(e =>
          console.error('[live] supabase patch falhou:', e.message)
        );
      }
    }

    console.log(`[live/fd] ${new Date().toISOString()} — ${result.length} partidas ativas`);
    result.forEach(r =>
      console.log(`  ${r.homeTeam} ${r.homeScore ?? '?'}-${r.awayScore ?? '?'} ${r.awayTeam} [${r.status} ${r.minute ?? ''}']`)
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ matches: result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function supabasePatch(utcDate, homeScore, awayScore) {
  const url = `${SUPA_URL}?scheduled_at=eq.${encodeURIComponent(utcDate)}&status=neq.FINISHED`;
  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey:          SERVICE_KEY,
      Authorization:   `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=minimal',
    },
    body: JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore }),
  });
  if (!patchRes.ok) {
    throw new Error(`Supabase ${patchRes.status}: ${await patchRes.text()}`);
  }
  console.log(`[live] supabase atualizado: ${utcDate} FINISHED ${homeScore}-${awayScore}`);
}
