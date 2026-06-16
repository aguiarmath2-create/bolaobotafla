// Vercel Serverless Function — live scores via ESPN public API (sem autenticação, sem rate limit).
// Busca os últimos 2 dias + hoje para capturar partidas recém-finalizadas que saíram do scoreboard.
// Quando FINISHED, grava no Supabase para o trigger trg_compute_match_points disparar.

const ESPN_BASE   = 'https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard';
const SUPA_URL    = 'https://pmrbtugoyuwlgobovlzg.supabase.co/rest/v1/matches';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ESPN_STATUS_MAP = {
  STATUS_IN_PROGRESS: 'IN_PLAY',
  STATUS_FIRST_HALF:  'IN_PLAY',
  STATUS_SECOND_HALF: 'IN_PLAY',
  STATUS_OVERTIME:    'IN_PLAY',
  STATUS_HALFTIME:    'PAUSED',
  STATUS_END_PERIOD:  'PAUSED',
  STATUS_FINAL:       'FINISHED',
  STATUS_FULL_TIME:   'FINISHED',
  STATUS_FT:          'FINISHED',
};

const SYNC_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'FINISHED']);

function espnUrl(daysOffset) {
  const d = new Date(Date.now() + daysOffset * 86400000);
  const s = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `${ESPN_BASE}?dates=${s}`;
}

async function fetchEspnEvents(url) {
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  return data.events || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Busca 2 dias atrás, ontem, hoje e amanhã em paralelo
    const [e2, e1, e0, e_1] = await Promise.all([
      fetchEspnEvents(espnUrl(-2)),
      fetchEspnEvents(espnUrl(-1)),
      fetchEspnEvents(espnUrl(0)),
      fetchEspnEvents(espnUrl(1)),
    ]);

    // Deduplica por event.id
    const seen = new Set();
    const events = [...e2, ...e1, ...e0, ...e_1].filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    // Debug: ?debug=1 retorna dados brutos da ESPN
    if (req.query?.debug === '1') {
      return res.status(200).json({
        total: events.length,
        events: events.map(e => ({
          date:   e.date,
          name:   e.name,
          status: e.status?.type?.name,
          clock:  e.status?.displayClock,
          period: e.status?.period,
          scores: e.competitions?.[0]?.competitors?.map(c => ({
            team:  c.team?.displayName,
            score: c.score,
            home:  c.homeAway,
          })),
        })),
      });
    }

    const result = [];

    for (const event of events) {
      const statusName = event.status?.type?.name;
      const status     = ESPN_STATUS_MAP[statusName];
      if (!status || !SYNC_STATUSES.has(status)) continue;

      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const clockStr  = event.status?.displayClock || '';
      const minute    = parseInt(clockStr.split(':')[0]) || null;
      const homeScore = parseInt(home.score);
      const awayScore = parseInt(away.score);

      result.push({
        utcDate:   event.date,
        status,
        minute,
        period:    event.status?.period ?? null,
        homeScore: isNaN(homeScore) ? null : homeScore,
        awayScore: isNaN(awayScore) ? null : awayScore,
        homeTeam:  home.team?.displayName,
        awayTeam:  away.team?.displayName,
      });

      // Quando FINISHED, grava no Supabase para o trigger calcular points_earned
      if (status === 'FINISHED' && SERVICE_KEY && !isNaN(homeScore) && !isNaN(awayScore)) {
        const utcDate = new Date(event.date).toISOString();
        supabasePatch(utcDate, homeScore, awayScore).catch(e =>
          console.error('[live] supabase patch falhou:', e.message)
        );
      }
    }

    console.log(`[live/espn] ${new Date().toISOString()} — ${result.length} partidas ativas`);
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
  const url = `${SUPA_URL}?scheduled_at=eq.${encodeURIComponent(utcDate)}`;
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
