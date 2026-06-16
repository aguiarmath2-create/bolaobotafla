// Bootstrap script: fetches ALL Copa do Mundo 2026 matches from football-data.org
// and imports them into Supabase via the import_copa_matches RPC.
// Run ONCE to populate all teams and all matches (or re-run to sync schedules).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=xxx FOOTBALL_DATA_API_KEY=xxx node scripts/import-all-matches.js

const SUPABASE_URL = 'https://pmrbtugoyuwlgobovlzg.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;

// Portuguese names for Copa 2026 teams
const PT_NAMES = {
  'Brazil': 'Brasil',
  'Morocco': 'Marrocos',
  'Scotland': 'Escócia',
  'United States': 'Estados Unidos',
  'Mexico': 'México',
  'Canada': 'Canadá',
  'Argentina': 'Argentina',
  'Colombia': 'Colômbia',
  'Uruguay': 'Uruguai',
  'Ecuador': 'Equador',
  'Paraguay': 'Paraguai',
  'Venezuela': 'Venezuela',
  'Peru': 'Peru',
  'Bolivia': 'Bolívia',
  'Chile': 'Chile',
  'Germany': 'Alemanha',
  'France': 'França',
  'Spain': 'Espanha',
  'Portugal': 'Portugal',
  'England': 'Inglaterra',
  'Netherlands': 'Holanda',
  'Belgium': 'Bélgica',
  'Italy': 'Itália',
  'Croatia': 'Croácia',
  'Switzerland': 'Suíça',
  'Denmark': 'Dinamarca',
  'Austria': 'Áustria',
  'Serbia': 'Sérvia',
  'Poland': 'Polônia',
  'Turkey': 'Turquia',
  'Greece': 'Grécia',
  'Hungary': 'Húngria',
  'Czech Republic': 'República Tcheca',
  'Czechia': 'República Tcheca',
  'Slovakia': 'Eslováquia',
  'Romania': 'Romênia',
  'Ukraine': 'Ucrânia',
  'Wales': 'País de Gales',
  'Algeria': 'Argélia',
  'Egypt': 'Egito',
  'Nigeria': 'Nigéria',
  'Senegal': 'Senegal',
  'Ghana': 'Gana',
  'Cameroon': 'Camarões',
  'Tunisia': 'Tunísia',
  "Ivory Coast": 'Costa do Marfim',
  "Côte d'Ivoire": 'Costa do Marfim',
  'South Africa': 'África do Sul',
  'DR Congo': 'Congo',
  'Democratic Republic of Congo': 'Congo',
  'Japan': 'Japão',
  'South Korea': 'Coreia do Sul',
  'Korea Republic': 'Coreia do Sul',
  'Saudi Arabia': 'Arábia Saudita',
  'Australia': 'Austrália',
  'Iran': 'Irã',
  'Iraq': 'Iraque',
  'Qatar': 'Catar',
  'China PR': 'China',
  'China': 'China',
  'Indonesia': 'Indonésia',
  'New Zealand': 'Nova Zelândia',
  'Costa Rica': 'Costa Rica',
  'Honduras': 'Honduras',
  'Panama': 'Panamá',
  'Jamaica': 'Jamaica',
  'Haiti': 'Haiti',
  'Sweden': 'Suécia',
  'Norway': 'Noruega',
  'Finland': 'Finlândia',
  'Iceland': 'Islândia',
  'Ireland': 'Irlanda',
  'Northern Ireland': 'Irlanda do Norte',
  'Slovenia': 'Eslovênia',
  'Albania': 'Albânia',
  'Georgia': 'Geórgia',
  'Israel': 'Israel',
  'Cape Verde': 'Cabo Verde',
  'Cape Verde Islands': 'Cabo Verde',
  'Bosnia-Herzegovina': 'Bósnia e Herzegovina',
  'Bosnia and Herzegovina': 'Bósnia e Herzegovina',
  'Bosnia & Herzegovina': 'Bósnia e Herzegovina',
  'Congo DR': 'Congo',
  'DR Congo': 'Congo',
  'Korea Republic': 'Coreia do Sul',
  'Republic of Ireland': 'Irlanda',
  'Mozambique': 'Moçambique',
  'Angola': 'Angola',
  'Zimbabwe': 'Zimbábue',
  'Zambia': 'Zâmbia',
  'Uganda': 'Uganda',
  'Comoros': 'Comores',
  'Tanzania': 'Tanzânia',
  'Benin': 'Benim',
  'Togo': 'Togo',
  'Guinea': 'Guiné',
  'Uzbekistan': 'Uzbequistão',
  'Thailand': 'Tailândia',
  'Jordan': 'Jordânia',
  'Palestine': 'Palestina',
  'United Arab Emirates': 'Emirados Árabes',
  'Kuwait': 'Kuwait',
  'Guatemala': 'Guatemala',
  'El Salvador': 'El Salvador',
  'Trinidad and Tobago': 'Trinidad e Tobago',
  'Cuba': 'Cuba',
  'Curaçao': 'Curaçao',
  'Suriname': 'Suriname',
  'Mali': 'Mali',
  'Bahrain': 'Barein',
  'Benin': 'Benim',
  'Libya': 'Líbia',
  'Kenya': 'Quênia',
  'Rwanda': 'Ruanda',
};

const STAGE_TO_ROUND = {
  GROUP_STAGE: 'GROUP',
  LAST_32: 'ROUND_OF_32',
  LAST_16: 'ROUND_OF_16',
  QUARTER_FINALS: 'QUARTER',
  SEMI_FINALS: 'SEMI',
  THIRD_PLACE: 'THIRD',
  FINAL: 'FINAL',
};

const STATUS_MAP = {
  FINISHED: 'FINISHED',
  IN_PLAY: 'LOCKED',
  PAUSED: 'LOCKED',
  TIMED: 'UPCOMING',
  SCHEDULED: 'UPCOMING',
};

function resolveScore(m) {
  const ft = m.score?.fullTime;
  if (ft?.home != null && ft?.away != null) return { home: ft.home, away: ft.away };
  return null;
}

function ptName(name) {
  if (!name) return null;
  return PT_NAMES[name] || name;
}

async function fetchJSON(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getLeagueId() {
  const data = await fetchJSON(`${SUPABASE_URL}/rest/v1/leagues?select=id&limit=1`, {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  });
  if (!data.length) throw new Error('Nenhuma liga encontrada no banco.');
  return data[0].id;
}

async function main() {
  if (!SERVICE_KEY || !FD_KEY) {
    console.error('Faltando env: SUPABASE_SERVICE_ROLE_KEY ou FOOTBALL_DATA_API_KEY');
    process.exit(1);
  }

  const leagueId = process.env.LEAGUE_ID || await getLeagueId();
  console.log(`Liga: ${leagueId}`);

  console.log('Buscando partidas no football-data.org...');
  const { matches } = await fetchJSON(
    'https://api.football-data.org/v4/competitions/WC/matches',
    { 'X-Auth-Token': FD_KEY }
  );
  console.log(`Total de partidas recebidas: ${matches.length}`);

  const valid = [];
  let skipped = 0;

  for (const m of matches) {
    const homeName = ptName(m.homeTeam?.name);
    const awayName = ptName(m.awayTeam?.name);

    // Pula partidas sem time mandante definido (mata-mata sem classificados)
    if (!homeName) { skipped++; continue; }

    const status = STATUS_MAP[m.status] || 'UPCOMING';
    const round = STAGE_TO_ROUND[m.stage] || 'GROUP';
    const score = resolveScore(m);

    // prediction_closes_at = 1 hora antes do início
    const kickoff = new Date(m.utcDate);
    const closes = new Date(kickoff.getTime() - 60 * 60 * 1000).toISOString();

    const entry = {
      home: homeName,
      home_flag: m.homeTeam?.crest || '',
      date: m.utcDate,
      round,
      group_round: m.matchday || null,
      group_name: m.group?.replace('GROUP_', 'Grupo ') || null,
      status,
      match_number: m.id,
      prediction_closes_at: closes,
    };

    if (awayName) {
      entry.away = awayName;
      entry.away_flag = m.awayTeam?.crest || '';
    } else {
      // Time visitante ainda não definido (mata-mata)
      entry.away = '';
      entry.away_placeholder = 'A definir';
    }

    if (score) {
      entry.home_score = score.home;
      entry.away_score = score.away;
    }

    valid.push(entry);
  }

  console.log(`Partidas para importar: ${valid.length} | Puladas (sem mandante): ${skipped}`);

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/import_copa_matches`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_league_id: leagueId, p_matches: valid }),
  });

  if (!rpcRes.ok) {
    const err = await rpcRes.text();
    console.error(`Erro no RPC (${rpcRes.status}): ${err}`);
    process.exit(1);
  }

  const count = await rpcRes.json();
  console.log(`Concluído! ${count} partidas importadas/atualizadas.`);
}

main().catch(err => { console.error(err); process.exit(1); });
