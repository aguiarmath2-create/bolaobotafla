// Vercel Serverless Function — resultados da Copa do Mundo 2026
//
// Fontes:
//   football-data.org  — status + placar final (FINISHED). Chave configurada na Vercel.
//   ESPN (sem auth)    — placar ao vivo (IN_PLAY). Gratuito, sem rate limit.
//
// Cache CDN s-maxage=15: todos os usuarios compartilham a mesma resposta por 15s.
// A football-data.org e chamada no maximo 4x/min independente de quantos usuarios estao no site.
//
// Quando FINISHED: grava no Supabase (await) para o trigger trg_compute_match_points disparar.

const FD_URL      = 'https://api.football-data.org/v4/competitions/WC/matches';
const ESPN_BASE   = 'https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard';
const SUPA_URL    = 'https://pmrbtugoyuwlgobovlzg.supabase.co/rest/v1/matches';
const FD_KEY      = process.env.FOOTBALL_DATA_API_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ACTIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'FINISHED']);

// Resolve placar final do football-data.org (so disponivel em FINISHED no plano gratuito).
function resolveScore(m) {
  const ft = m.score?.fullTime;
  if (ft?.home !== null && ft?.home !== undefined && ft?.away !== null && ft?.away !== undefined) {
    return { home: ft.home, away: ft.away };
  }
  const rt = m.score?.regularTime;
  if (rt?.home !== null && rt?.home !== undefined && rt?.away !== null && rt?.away !== undefined) {
    return { home: rt.home, away: rt.away };
  }
  return null;
}

// Busca placares ao vivo da ESPN para varios dias (sem autenticacao).
// Retorna mapa: timestamp_ms -> { homeScore, awayScore, minute, period }
async function fetchEspnLiveMap() {
  try {
    const results = await Promise.all(
      [-1, 0, 1].map(d => {
        const date = new Date(Date.now() + d * 86400000);
        const s = date.toISOString().slice(0, 10).replace(/-/g, '');
        return fetch(`${ESPN_BASE}?dates=${s}`)
          .then(r => r.ok ? r.json() : { events: [] })
          .catch(() => ({ events: [] }));
      })
    );

    const map = {};
    const allEvents = results.flatMap(r => r.events || []);
    const seen = new Set();

    for (const ev of allEvents) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);

      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      // Inclui qualquer evento com placar numerico disponivel (ignora status ESPN).
      // O status football-data.org e quem determina se a partida esta ativa.
      const homeScore = parseInt(home.score);
      const awayScore = parseInt(away.score);
      if (isNaN(homeScore) || isNaN(awayScore)) continue;

      const clock  = ev.status?.displayClock || '';
      const minute = parseInt(clock.split(':')[0]) || null;
      const ts     = new Date(ev.date).getTime();

      map[ts] = {
        homeScore,
        awayScore,
        minute,
        period: ev.status?.period ?? null,
      };
    }

    return map;
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=5');

  if (!FD_KEY) {
    return res.status(500).json({ error: 'FOOTBALL_DATA_API_KEY nao configurado na Vercel' });
  }

  try {
    // Busca FD + ESPN em paralelo
    const [fdRes, espnLiveMap] = await Promise.all([
      fetch(FD_URL, { headers: { 'X-Auth-Token': FD_KEY } }),
      fetchEspnLiveMap(),
    ]);

    if (!fdRes.ok) {
      const text = await fdRes.text();
      return res.status(502).json({ error: `football-data.org ${fdRes.status}: ${text}` });
    }

    const { matches: allMatches } = await fdRes.json();
    const active = (allMatches || []).filter(m => ACTIVE_STATUSES.has(m.status));

    // Debug: ?debug=1
    if (req.query?.debug === '1') {
      return res.status(200).json({
        fd_total:   allMatches?.length ?? 0,
        fd_active:  active.length,
        espn_live:  Object.keys(espnLiveMap).length,
        fd_matches: active.map(m => ({
          id:       m.id,
          utcDate:  m.utcDate,
          status:   m.status,
          minute:   m.minute,
          homeTeam: m.homeTeam?.shortName,
          awayTeam: m.awayTeam?.shortName,
          score:    m.score,
        })),
        espn_matches: Object.entries(espnLiveMap).map(([ts, d]) => ({
          utcDate: new Date(Number(ts)).toISOString(),
          ...d,
        })),
      });
    }

    const result = [];

    for (const m of active) {
      const fdScore   = resolveScore(m);   // placar final do FD (null durante a partida)
      const fdTs      = new Date(m.utcDate).getTime();
      const mappedStatus = m.status === 'FINISHED' ? 'FINISHED'
                         : m.status === 'PAUSED'   ? 'PAUSED'
                         : 'IN_PLAY';

      // Busca placar ao vivo da ESPN para partidas em andamento
      let espnData = null;
      if (mappedStatus !== 'FINISHED') {
        for (const [espnTs, data] of Object.entries(espnLiveMap)) {
          if (Math.abs(fdTs - Number(espnTs)) < 90000) { // 90 s de tolerancia
            espnData = data;
            break;
          }
        }
      }

      result.push({
        id:        m.id,
        utcDate:   m.utcDate,
        status:    mappedStatus,
        minute:    espnData?.minute ?? m.minute ?? null,
        period:    espnData?.period ?? null,
        homeScore: fdScore?.home ?? espnData?.homeScore ?? null,
        awayScore: fdScore?.away ?? espnData?.awayScore ?? null,
        homeTeam:  m.homeTeam?.name,
        awayTeam:  m.awayTeam?.name,
      });

      // FINISHED: aguarda gravacao no Supabase antes de responder ao cliente.
      // Garante que loadData() depois desta resposta ja vera o status atualizado.
      if (m.status === 'FINISHED' && fdScore && SERVICE_KEY) {
        await supabasePatch(m, fdScore.home, fdScore.away).catch(e =>
          console.error('[live] supabase patch falhou:', e.message)
        );
      }
    }

    console.log(`[live] ${new Date().toISOString()} fd:${active.length} espn:${Object.keys(espnLiveMap).length}`);
    result.forEach(r => {
      const s = r.homeScore !== null ? `${r.homeScore}-${r.awayScore}` : '?-?';
      console.log(`  ${r.homeTeam} ${s} ${r.awayTeam} [${r.status}${r.minute ? ' ' + r.minute + "'" : ''}]`);
    });

    return res.status(200).json({ matches: result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Atualiza match no Supabase: tenta timestamp exato e fallback ±30 min.
// O ±30 min cobre diferencas de formato entre import_copa_matches e football-data.org.
async function supabasePatch(fdMatch, homeScore, awayScore) {
  const body = JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore });
  const hdr  = {
    apikey:         SERVICE_KEY,
    Authorization:  `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer:         'return=representation',
  };

  // Tentativa 1: timestamp exato
  const r1 = await fetch(
    `${SUPA_URL}?match_number=eq.${encodeURIComponent(fdMatch.id)}`,
    { method: 'PATCH', headers: hdr, body }
  );
  if (r1.ok) {
    const updated = await r1.json();
    if (updated.length > 0) {
      console.log(`[live] supabase: match_number ${fdMatch.id} FINISHED ${homeScore}-${awayScore}`);
      return;
    }
  }
  if (!r1.ok) console.error(`[live] patch match_number ${r1.status}: ${await r1.text()}`);

  // Tentativa 2: range ±30 min (captura diferencas de formato de data)
  const ts = new Date(fdMatch.utcDate).getTime();
  const lo = new Date(ts - 30 * 60000).toISOString();
  const hi = new Date(ts + 30 * 60000).toISOString();
  const candidatesRes = await fetch(
    `${SUPA_URL}?select=id,scheduled_at,home_team:teams!matches_home_team_id_fkey(name),away_team:teams!matches_away_team_id_fkey(name)&scheduled_at=gte.${encodeURIComponent(lo)}&scheduled_at=lte.${encodeURIComponent(hi)}&status=neq.FINISHED`,
    { headers: hdr }
  );
  if (!candidatesRes.ok) {
    console.error(`[live] fallback select ${candidatesRes.status}: ${await candidatesRes.text()}`);
    return;
  }

  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const home = norm(fdMatch.homeTeam?.name);
  const away = norm(fdMatch.awayTeam?.name);
  const candidates = await candidatesRes.json();
  const found = candidates.find(c => {
    const ch = norm(c.home_team?.name);
    const ca = norm(c.away_team?.name);
    return (ch.includes(home) || home.includes(ch)) && (ca.includes(away) || away.includes(ca));
  });
  if (!found) {
    console.error(`[live] fallback nao encontrou match para ${fdMatch.homeTeam?.name} x ${fdMatch.awayTeam?.name} ${fdMatch.utcDate}`);
    return;
  }

  const r2 = await fetch(`${SUPA_URL}?id=eq.${encodeURIComponent(found.id)}`, { method: 'PATCH', headers: hdr, body });
  if (!r2.ok) {
    console.error(`[live] patch fallback ${r2.status}: ${await r2.text()}`);
    return;
  }

  console.log(`[live] supabase: fallback id ${found.id} FINISHED ${homeScore}-${awayScore}`);
}
