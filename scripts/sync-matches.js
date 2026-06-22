// Syncs FIFA World Cup 2026 results from football-data.org into Supabase.
// Matches are identified first by match_number (FD ID), then by timestamp ±30 min.
// The DB trigger trg_recalculate_match_predictions auto-updates points_earned.

const SUPABASE_URL = 'https://pmrbtugoyuwlgobovlzg.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard';

// Resolve current score from any populated field the API returns.
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

// Fetches ESPN scoreboard for ±1 days and returns a map: timestamp_ms -> { homeScore, awayScore }
async function fetchEspnScores() {
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

      const homeScore = parseInt(home.score);
      const awayScore = parseInt(away.score);
      if (isNaN(homeScore) || isNaN(awayScore)) continue;

      const espnStatus = ev.status?.type?.name || '';
      // Only include matches that ESPN considers finished
      if (!['STATUS_FINAL', 'STATUS_FULL_TIME'].includes(espnStatus)) continue;

      const ts = new Date(ev.date).getTime();
      map[ts] = { homeScore, awayScore };
    }

    return map;
  } catch {
    return {};
  }
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

  // Attempt 1: match by FD match ID stored in match_number column (no status filter)
  const r1 = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?match_number=eq.${encodeURIComponent(m.id)}`,
    { method: 'PATCH', headers: hdr, body }
  );
  if (r1.ok) {
    const updated = await r1.json();
    if (updated.length > 0) {
      const row = updated[0];
      const already = row.status === 'FINISHED' && row.home_score === homeScore && row.away_score === awayScore;
      if (already) {
        console.log(`SKIP ${m.homeTeam?.shortName} ${homeScore}-${awayScore} ${m.awayTeam?.shortName} [already correct in DB]`);
      } else {
        console.log(`OK   ${m.homeTeam?.shortName} ${homeScore}-${awayScore} ${m.awayTeam?.shortName} [via match_number]`);
      }
      return true;
    }
  } else {
    console.error(`ERR  patch match_number ${m.id}: ${r1.status} ${await r1.text()}`);
  }

  // Attempt 2: find by timestamp ±30 min (no status filter — handles re-sync of wrong scores too)
  const ts = new Date(m.utcDate).getTime();
  const lo = new Date(ts - 30 * 60000).toISOString();
  const hi = new Date(ts + 30 * 60000).toISOString();
  const candidatesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?select=id,scheduled_at,status,home_score,away_score,home_team:teams!matches_home_team_id_fkey(name),away_team:teams!matches_away_team_id_fkey(name)` +
    `&scheduled_at=gte.${encodeURIComponent(lo)}&scheduled_at=lte.${encodeURIComponent(hi)}`,
    { headers: hdr }
  );
  if (!candidatesRes.ok) {
    console.error(`ERR  fallback select for match ${m.id}: ${candidatesRes.status} ${await candidatesRes.text()}`);
    return false;
  }

  const candidates = await candidatesRes.json();
  if (candidates.length === 0) {
    console.warn(`WARN ${m.homeTeam?.shortName} x ${m.awayTeam?.shortName} — not found in DB (match_number=${m.id}, utcDate=${m.utcDate})`);
    return false;
  }

  // Single candidate in window: use it without name matching (PT vs EN names diverge)
  // Multiple candidates: try name similarity with EN↔PT alias map
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // FD API uses English names; DB may use Portuguese. Map both directions.
  const ALIASES = {
    'brazil': 'brasil', 'brasil': 'brazil',
    'morocco': 'marrocos', 'marrocos': 'morocco',
    'germany': 'alemanha', 'alemanha': 'germany',
    'spain': 'espanha', 'espanha': 'spain',
    'france': 'franca', 'franca': 'france',
    'ivory coast': 'costa do marfim', 'costa do marfim': 'ivory coast',
    'south korea': 'coreia do sul', 'coreia do sul': 'south korea',
    'korea republic': 'coreia do sul', 'republic of korea': 'coreia do sul',
    'saudi arabia': 'arabia saudita', 'arabia saudita': 'saudi arabia',
    'cape verde': 'cabo verde', 'cabo verde': 'cape verde',
    'congo dr': 'republica democratica do congo',
    'dr congo': 'republica democratica do congo',
    'new zealand': 'nova zelandia', 'nova zelandia': 'new zealand',
    'czechia': 'republica tcheca', 'czech republic': 'republica tcheca',
    'bosnia-h.': 'bosnia e herzegovina', 'bosnia and herzegovina': 'bosnia e herzegovina',
    'bosnia': 'bosnia e herzegovina',
    'switzerland': 'suica', 'suica': 'switzerland',
    'netherlands': 'paises baixos', 'paises baixos': 'netherlands',
    'uzbekistan': 'uzbequistao', 'uzbequistao': 'uzbekistan',
    'england': 'inglaterra', 'inglaterra': 'england',
    'scotland': 'escocia', 'escocia': 'scotland',
    'portugal': 'portugal',
  };

  const nameMatches = (fdName, dbName) => {
    const fd = norm(fdName);
    const db = norm(dbName);
    if (fd.includes(db) || db.includes(fd)) return true;
    const alias = ALIASES[fd];
    if (alias && (alias.includes(db) || db.includes(alias))) return true;
    return false;
  };

  let found;
  if (candidates.length === 1) {
    found = candidates[0];
  } else {
    found = candidates.find(c =>
      nameMatches(m.homeTeam?.name, c.home_team?.name) &&
      nameMatches(m.awayTeam?.name, c.away_team?.name)
    );
  }

  if (!found) {
    console.error(`ERR  fallback: no name match for ${m.homeTeam?.name} x ${m.awayTeam?.name} in ${candidates.length} candidate(s)`);
    return false;
  }

  // Skip if already correct (avoid re-triggering DB trigger unnecessarily)
  if (found.status === 'FINISHED' && found.home_score === homeScore && found.away_score === awayScore) {
    console.log(`SKIP ${m.homeTeam?.shortName} ${homeScore}-${awayScore} ${m.awayTeam?.shortName} [already correct in DB via fallback]`);
    return true;
  }

  // Store FD match_number so next sync uses the fast path
  const bodyWithId = JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore, match_number: m.id });
  const r2 = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?id=eq.${encodeURIComponent(found.id)}`,
    { method: 'PATCH', headers: hdr, body: bodyWithId }
  );
  if (!r2.ok) {
    console.error(`ERR  fallback patch id=${found.id}: ${r2.status} ${await r2.text()}`);
    return false;
  }
  console.log(`OK   ${m.homeTeam?.shortName} ${homeScore}-${awayScore} ${m.awayTeam?.shortName} [via fallback, match_number=${m.id} stored]`);
  return true;
}

async function main() {
  if (!SERVICE_KEY || !FD_KEY) {
    console.error('Missing env: SUPABASE_SERVICE_ROLE_KEY or FOOTBALL_DATA_API_KEY');
    process.exit(1);
  }

  const [fdRes, espnMap] = await Promise.all([
    fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': FD_KEY },
    }),
    fetchEspnScores(),
  ]);

  if (!fdRes.ok) {
    console.error(`football-data.org ${fdRes.status}: ${await fdRes.text()}`);
    process.exit(1);
  }

  const { matches } = await fdRes.json();
  const finished = matches.filter(m => m.status === 'FINISHED');
  console.log(`Finished from football-data.org: ${finished.length} | ESPN confirmed finished: ${Object.keys(espnMap).length}`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of finished) {
    let score = resolveScore(m);

    // ESPN fallback: se football-data.org não retornou placar, tenta ESPN
    if (!score) {
      const fdTs = new Date(m.utcDate).getTime();
      for (const [espnTs, espnData] of Object.entries(espnMap)) {
        if (Math.abs(fdTs - Number(espnTs)) < 90000) {
          score = { home: espnData.homeScore, away: espnData.awayScore, source: 'espn' };
          break;
        }
      }
    }

    if (!score) {
      console.warn(`SKIP ${m.homeTeam?.shortName} x ${m.awayTeam?.shortName} — no score available`);
      skipped++;
      continue;
    }

    const success = await supabasePatch(m, score.home, score.away);
    if (success) ok++; else failed++;
  }

  console.log(`Done: ${ok} ok, ${skipped} skipped (no score), ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
