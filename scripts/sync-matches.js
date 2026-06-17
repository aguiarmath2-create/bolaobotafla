// Syncs FIFA World Cup 2026 results from football-data.org into Supabase.
// Matches are identified first by match_number (FD ID), then by timestamp ±30 min.
// The DB trigger trg_recalculate_match_predictions auto-updates points_earned.

const SUPABASE_URL = 'https://pmrbtugoyuwlgobovlzg.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;

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

// Patches a match to FINISHED in Supabase.
// Tries match_number first; falls back to timestamp ±30 min if 0 rows updated.
// Also stores the FD match_number on the record so future syncs hit on first try.
async function supabasePatch(m, homeScore, awayScore) {
  const hdr = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const body = JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore });

  // Attempt 1: match by FD match ID stored in match_number column
  const r1 = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?match_number=eq.${encodeURIComponent(m.id)}`,
    { method: 'PATCH', headers: hdr, body }
  );
  if (r1.ok) {
    const updated = await r1.json();
    if (updated.length > 0) {
      console.log(`OK  ${m.homeTeam?.shortName} ${homeScore}-${awayScore} ${m.awayTeam?.shortName} [FINISHED via match_number]`);
      return;
    }
  } else {
    console.error(`ERR patch match_number ${m.id}: ${r1.status} ${await r1.text()}`);
  }

  // Attempt 2: find by timestamp ±30 min (covers import date format differences)
  const ts = new Date(m.utcDate).getTime();
  const lo = new Date(ts - 30 * 60000).toISOString();
  const hi = new Date(ts + 30 * 60000).toISOString();
  const candidatesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?select=id,scheduled_at,home_team:teams!matches_home_team_id_fkey(name),away_team:teams!matches_away_team_id_fkey(name)` +
    `&scheduled_at=gte.${encodeURIComponent(lo)}&scheduled_at=lte.${encodeURIComponent(hi)}&status=neq.FINISHED`,
    { headers: hdr }
  );
  if (!candidatesRes.ok) {
    console.error(`ERR fallback select for match ${m.id}: ${candidatesRes.status} ${await candidatesRes.text()}`);
    return;
  }

  const candidates = await candidatesRes.json();
  if (candidates.length === 0) {
    console.warn(`SKIP ${m.homeTeam?.shortName} x ${m.awayTeam?.shortName} — not found in DB (match_number=${m.id}, utcDate=${m.utcDate})`);
    return;
  }

  // Single candidate in window: use it without name matching (PT vs EN names diverge)
  // Multiple candidates: try name similarity
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let found;
  if (candidates.length === 1) {
    found = candidates[0];
  } else {
    const home = norm(m.homeTeam?.name);
    const away = norm(m.awayTeam?.name);
    found = candidates.find(c => {
      const ch = norm(c.home_team?.name);
      const ca = norm(c.away_team?.name);
      return (ch.includes(home) || home.includes(ch)) && (ca.includes(away) || away.includes(ca));
    });
  }

  if (!found) {
    console.error(`ERR fallback: no name match for ${m.homeTeam?.name} x ${m.awayTeam?.name} in ${candidates.length} candidates`);
    return;
  }

  // Store FD match_number so next sync uses the fast path
  const bodyWithId = JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore, match_number: m.id });
  const r2 = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?id=eq.${encodeURIComponent(found.id)}`,
    { method: 'PATCH', headers: hdr, body: bodyWithId }
  );
  if (!r2.ok) {
    console.error(`ERR fallback patch id=${found.id}: ${r2.status} ${await r2.text()}`);
    return;
  }
  console.log(`OK  ${m.homeTeam?.shortName} ${homeScore}-${awayScore} ${m.awayTeam?.shortName} [FINISHED via fallback, match_number=${m.id} stored]`);
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
  const finished = matches.filter(m => m.status === 'FINISHED');
  console.log(`Finished matches from API: ${finished.length}`);

  let updated = 0;
  let skipped = 0;

  for (const m of finished) {
    const score = resolveScore(m);
    if (!score) {
      console.warn(`SKIP ${m.homeTeam?.shortName} x ${m.awayTeam?.shortName} — no score available`);
      skipped++;
      continue;
    }

    await supabasePatch(m, score.home, score.away);
    updated++;
  }

  console.log(`Done: ${updated} processed, ${skipped} skipped (no score)`);
}

main().catch(err => { console.error(err); process.exit(1); });
