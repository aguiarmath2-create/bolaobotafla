// Vercel Serverless Function — live scores proxy using ESPN public API.
// ESPN returns live scores without authentication, unlike football-data.org free tier
// which stays "TIMED" and never updates to IN_PLAY during a match.
// When ESPN reports FINISHED, this function also writes to Supabase so the
// DB trigger trg_recalculate_match_predictions fires automatically.

const ESPN_URL    = 'https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const espnRes = await fetch(ESPN_URL);
    if (!espnRes.ok) {
      return res.status(espnRes.status).json({ error: `ESPN API error: ${espnRes.status}` });
    }

    const data   = await espnRes.json();
    const events = data.events || [];

    // Debug mode: ?debug=1 returns raw ESPN data
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

      const clockStr = event.status?.displayClock || '';
      const minute   = parseInt(clockStr.split(':')[0]) || null;
      const homeScore = parseInt(home.score);
      const awayScore = parseInt(away.score);

      result.push({
        utcDate:  event.date,
        status,
        minute,
        period:   event.status?.period ?? null,
        homeScore: isNaN(homeScore) ? null : homeScore,
        awayScore: isNaN(awayScore) ? null : awayScore,
        homeTeam: home.team?.displayName,
        awayTeam: away.team?.displayName,
      });

      // When ESPN says FINISHED, write to Supabase so the DB trigger fires
      // and recalculates points_earned for all predictions automatically.
      if (status === 'FINISHED' && SERVICE_KEY && !isNaN(homeScore) && !isNaN(awayScore)) {
        const utcDate = new Date(event.date).toISOString();
        supabasePatch(utcDate, homeScore, awayScore).catch(e =>
          console.error('[live] supabase patch failed:', e.message)
        );
      }
    }

    console.log(`[live/espn] ${new Date().toISOString()} — ${result.length} active matches`);
    result.forEach(r =>
      console.log(`  ${r.homeTeam} ${r.homeScore}-${r.awayScore} ${r.awayTeam} [${r.status} ${r.minute}']`)
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
    const text = await patchRes.text();
    throw new Error(`Supabase ${patchRes.status}: ${text}`);
  }
  console.log(`[live] patched supabase: ${utcDate} FINISHED ${homeScore}-${awayScore}`);
}
