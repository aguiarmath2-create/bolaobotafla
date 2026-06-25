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

// Mapa de aliases PT↔EN para nomes de seleções. Usado em todos os name-matchings deste arquivo.
const ALIASES = {
  'brazil': 'brasil',          'brasil': 'brazil',
  'morocco': 'marrocos',       'marrocos': 'morocco',
  'germany': 'alemanha',       'alemanha': 'germany',
  'spain': 'espanha',          'espanha': 'spain',
  'france': 'franca',          'franca': 'france',
  'scotland': 'escocia',       'escocia': 'scotland',
  'england': 'inglaterra',     'inglaterra': 'england',
  'netherlands': 'paises baixos', 'paises baixos': 'netherlands',
  'switzerland': 'suica',      'suica': 'switzerland',
  'ivory coast': 'costa do marfim', 'costa do marfim': 'ivory coast',
  'south korea': 'coreia do sul', 'coreia do sul': 'south korea',
  'korea republic': 'coreia do sul', 'republic of korea': 'coreia do sul',
  'saudi arabia': 'arabia saudita', 'arabia saudita': 'saudi arabia',
  'cape verde': 'cabo verde',  'cabo verde': 'cape verde',
  'new zealand': 'nova zelandia', 'nova zelandia': 'new zealand',
  'czechia': 'republica tcheca', 'czech republic': 'republica tcheca',
  'uzbekistan': 'uzbequistao', 'uzbequistao': 'uzbekistan',
};

function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function namesMatch(a, b) {
  const fa = normName(a), fb = normName(b);
  if (fa.includes(fb) || fb.includes(fa)) return true;
  const alias = ALIASES[fa];
  return !!(alias && (alias.includes(fb) || fb.includes(alias)));
}

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

// Para partidas FINISHED, busca placar do Supabase (fonte de verdade para correções manuais).
// Retorna mapa: match_number -> { home, away }
async function fetchSupabaseFinishedScores(matchNumbers) {
  if (!SERVICE_KEY || matchNumbers.length === 0) return {};
  try {
    const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const r = await fetch(
      `${SUPA_URL}?select=match_number,home_score,away_score&match_number=in.(${matchNumbers.join(',')})&status=eq.FINISHED`,
      { headers: hdr }
    );
    if (!r.ok) return {};
    const rows = await r.json();
    const map = {};
    for (const row of rows) {
      if (row.match_number != null) map[row.match_number] = { home: row.home_score, away: row.away_score };
    }
    return map;
  } catch {
    return {};
  }
}

// Busca placares ao vivo da ESPN para varios dias (sem autenticacao).
// Retorna array de eventos com { ts, homeScore, awayScore, minute, period, espnStatus, homeTeam, awayTeam }.
// Array (em vez de mapa por timestamp) para lidar corretamente com jogos simultâneos.
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

    // Array em vez de mapa: evita colisão quando dois jogos têm o mesmo horário de início
    // (fase de grupos da Copa — os dois jogos do grupo sempre iniciam ao mesmo tempo).
    const events = [];
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

      events.push({
        ts:         new Date(ev.date).getTime(),
        homeScore,
        awayScore,
        minute,
        period:     ev.status?.period ?? null,
        espnStatus: ev.status?.type?.name || null,
        homeTeam:   home.team?.displayName || home.team?.name || '',
        awayTeam:   away.team?.displayName || away.team?.name || '',
      });
    }

    return events;
  } catch {
    return [];
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

    // Para partidas FINISHED, busca placares do Supabase (fonte de verdade).
    // Isso permite que correções manuais no banco sejam refletidas na UI.
    const finishedIds = active.filter(m => m.status === 'FINISHED').map(m => m.id);
    const supaScores = await fetchSupabaseFinishedScores(finishedIds);

    // Debug: ?debug=1
    if (req.query?.debug === '1') {
      return res.status(200).json({
        fd_total:   allMatches?.length ?? 0,
        fd_active:  active.length,
        espn_live:  espnLiveMap.length,
        fd_matches: active.map(m => ({
          id:       m.id,
          utcDate:  m.utcDate,
          status:   m.status,
          minute:   m.minute,
          homeTeam: m.homeTeam?.shortName,
          awayTeam: m.awayTeam?.shortName,
          score:    m.score,
        })),
        espn_matches: espnLiveMap.map(e => ({
          utcDate: new Date(e.ts).toISOString(),
          ...e,
        })),
      });
    }

    const result = [];

    // Statuses da ESPN que indicam partida definitivamente encerrada.
    // STATUS_END_PERIOD NAO esta aqui: ocorre ao fim de cada periodo (90', 120') e
    // pode ser seguido de prorrogacao ou penaltis — marcaria FINISHED prematuramente.
    const ESPN_FINAL = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME']);

    for (const m of active) {
      const fdScore = resolveScore(m);
      const fdTs    = new Date(m.utcDate).getTime();
      let mappedStatus = m.status === 'FINISHED' ? 'FINISHED'
                       : m.status === 'PAUSED'   ? 'PAUSED'
                       : 'IN_PLAY';

      // Busca dados da ESPN para a partida.
      // Quando dois jogos têm o mesmo horário (fase de grupos), desambigua pelo nome do time.
      const espnCandidates = espnLiveMap.filter(e => Math.abs(fdTs - e.ts) < 90000);
      let espnData = espnCandidates.length === 1
        ? espnCandidates[0]
        : (espnCandidates.find(e =>
            namesMatch(m.homeTeam?.name, e.homeTeam) &&
            namesMatch(m.awayTeam?.name, e.awayTeam)
          ) ?? espnCandidates[0] ?? null);

      // Se ESPN ja marcou como encerrado mas FD ainda nao atualizou, trata como FINISHED
      if (mappedStatus !== 'FINISHED' && espnData && ESPN_FINAL.has(espnData.espnStatus)) {
        mappedStatus = 'FINISHED';
      }

      // Placar: Supabase tem prioridade para FINISHED (permite correções manuais);
      // para IN_PLAY/PAUSED usa FD com fallback para ESPN.
      const supaScore = mappedStatus === 'FINISHED' ? supaScores[m.id] ?? null : null;
      const effectiveScore = supaScore
        ?? fdScore
        ?? (mappedStatus === 'FINISHED' && espnData
            ? { home: espnData.homeScore, away: espnData.awayScore }
            : null);

      result.push({
        id:        m.id,
        utcDate:   m.utcDate,
        status:    mappedStatus,
        minute:    mappedStatus !== 'FINISHED' ? (espnData?.minute ?? m.minute ?? null) : null,
        period:    mappedStatus !== 'FINISHED' ? (espnData?.period ?? null) : null,
        homeScore: effectiveScore?.home ?? espnData?.homeScore ?? null,
        awayScore: effectiveScore?.away ?? espnData?.awayScore ?? null,
        homeTeam:  m.homeTeam?.name,
        awayTeam:  m.awayTeam?.name,
      });

      // FINISHED: grava no Supabase apenas se ainda não estava FINISHED (proteção já na query).
      if (mappedStatus === 'FINISHED' && effectiveScore && SERVICE_KEY && !supaScore) {
        await supabasePatch(m, effectiveScore.home, effectiveScore.away).catch(e =>
          console.error('[live] supabase patch falhou:', e.message)
        );
      }
    }

    console.log(`[live] ${new Date().toISOString()} fd:${active.length} espn:${espnLiveMap.length}`);
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

  // Tentativa 1: por match_number — só atualiza se ainda não está FINISHED
  // (evita sobrescrever correções manuais com dados desatualizados da API)
  const r1 = await fetch(
    `${SUPA_URL}?match_number=eq.${encodeURIComponent(fdMatch.id)}&status=neq.FINISHED`,
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

  const candidates = await candidatesRes.json();

  // Se s\u00f3 h\u00e1 um candidato na janela de \u00b130 min, usa sem verificar nome.
  // Se houver mais de um (jogos simult\u00e2neos), desambigua com alias PT\u2194EN.
  let found;
  if (candidates.length === 1) {
    found = candidates[0];
  } else {
    found = candidates.find(c =>
      namesMatch(fdMatch.homeTeam?.name, c.home_team?.name) &&
      namesMatch(fdMatch.awayTeam?.name, c.away_team?.name)
    );
  }

  if (!found) {
    console.error(`[live] fallback nao encontrou match para ${fdMatch.homeTeam?.name} x ${fdMatch.awayTeam?.name} ${fdMatch.utcDate}`);
    return;
  }

  // Aproveita para gravar o match_number correto (FD ID) para lookups futuros
  const bodyWithMatchNum = JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore, match_number: fdMatch.id });
  const r2 = await fetch(`${SUPA_URL}?id=eq.${encodeURIComponent(found.id)}`, { method: 'PATCH', headers: hdr, body: bodyWithMatchNum });
  if (!r2.ok) {
    console.error(`[live] patch fallback ${r2.status}: ${await r2.text()}`);
    return;
  }

  console.log(`[live] supabase: fallback id ${found.id} FINISHED ${homeScore}-${awayScore} (match_number=${fdMatch.id} gravado)`);
}
