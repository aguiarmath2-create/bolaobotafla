// Syncs FIFA World Cup 2026 results from football-data.org into Supabase.
// Matches are identified by scheduled_at (UTC) == utcDate from the API.
// The DB trigger trg_recalculate_match_predictions auto-updates points_earned.

const SUPABASE_URL = 'https://pmrbtugoyuwlgobovlzg.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;

const STATUS_MAP = {
  FINISHED: 'FINISHED',
};

// Resolve current score from any populated field the API returns.
// football-data.org free tier may keep score.fullTime null during IN_PLAY
// and only populate it at FINISHED. Fallback order:
//   1. score.fullTime  (populated for FINISHED; sometimes for IN_PLAY)
//   2. score.regularTime (alternate field in some responses)
//   3. count from goals[] array (most reliable for live)
function resolveScore(m) {
  const ft = m.score?.fullTime;
  if (ft?.home !== null && ft?.home !== undefined && ft?.away !== null && ft?.away !== undefined) {
    return { home: ft.home, away: ft.away, source: 'fullTime' };
  }

  const rt = m.score?.regularTime;
  if (rt?.home !== null && rt?.home !== undefined && rt?.away !== null && rt?.away !== undefined) {
    return { home: rt.home, away: rt.away, source: 'regularTime' };
  }

  const goals = m.goals;
  if (Array.isArray(goals)) {
    const homeId = m.homeTeam?.id;
    const awayId = m.awayTeam?.id;
    let home = 0, away = 0;
    for (const g of goals) {
      if (g.type === 'OWN_GOAL') {
        if (g.team?.id === homeId) away++; else home++;
      } else {
        if (g.team?.id === homeId) home++; else away++;
      }
    }
    return { home, away, source: 'goals[]' };
  }

  return null;
}

async function main() {
  if (!SERVICE_KEY || !FD_KEY) {
    console.error('Missing env: SUPABASE_SERVICE_ROLE_KEY or FOOTBALL_DATA_API_KEY');
    process.exit(1);
  }

  const fdRes = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': FD_KEY },
  });

  if (!fdRes.ok) {
    console.error(`football-data.org ${fdRes.status}: ${await fdRes.text()}`);
    process.exit(1);
  }

  const { matches } = await fdRes.json();
  const toSync = matches.filter(m => STATUS_MAP[m.status]);
  console.log(`Matches to sync: ${toSync.length}`);

  // Live status is intentionally not persisted because the database check constraint
  // only allows durable states. The frontend live poll handles in-game display.
  const liveMatches = [];
  if (liveMatches.length > 0) {
    console.log('--- LIVE match raw score fields ---');
    for (const m of liveMatches) {
      console.log(JSON.stringify({
        match: `${m.homeTeam?.shortName} vs ${m.awayTeam?.shortName}`,
        status: m.status,
        minute: m.minute,
        score: m.score,
        goalsCount: m.goals?.length,
      }, null, 2));
    }
    console.log('-----------------------------------');
  }

  let updated = 0;
  let skipped = 0;

  for (const m of toSync) {
    const status = STATUS_MAP[m.status];
    const score = resolveScore(m);

    const body = { status };
    if (score) {
      body.home_score = score.home;
      body.away_score = score.away;
    }

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/matches?scheduled_at=eq.${encodeURIComponent(m.utcDate)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }
    );

    if (patchRes.ok) {
      updated++;
      const scoreStr = score ? `${score.home}-${score.away} (via ${score.source})` : '?-?';
      console.log(`OK  ${m.homeTeam?.shortName} ${scoreStr} ${m.awayTeam?.shortName} [${status}]`);
    } else {
      skipped++;
      console.error(`ERR match ${m.id} (${m.utcDate}): ${await patchRes.text()}`);
    }
  }

  console.log(`Done: ${updated} updated, ${skipped} errors`);
}

main().catch(err => { console.error(err); process.exit(1); });

