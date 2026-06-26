// Sincroniza times das fases eliminatórias via football-data.org.
// Roda periodicamente pelo GitHub Actions (ver .github/workflows/sync-bracket.yml).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=xxx FOOTBALL_DATA_API_KEY=xxx node scripts/sync-bracket.js

const SUPABASE_URL = 'https://pmrbtugoyuwlgobovlzg.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FD_KEY       = process.env.FOOTBALL_DATA_API_KEY;
const SUPA_REST    = `${SUPABASE_URL}/rest/v1`;

const KNOCKOUT_STAGES = new Set([
  'LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL',
]);
const STAGE_ROUND = {
  LAST_32:        'ROUND_OF_32',
  LAST_16:        'ROUND_OF_16',
  QUARTER_FINALS: 'QUARTER',
  SEMI_FINALS:    'SEMI',
  THIRD_PLACE:    'THIRD',
  FINAL:          'FINAL',
};
const PT_NAMES = {
  'Brazil': 'Brasil',             'Morocco': 'Marrocos',
  'Scotland': 'Escócia',          'United States': 'Estados Unidos',
  'Mexico': 'México',             'Canada': 'Canadá',
  'Colombia': 'Colômbia',         'Uruguay': 'Uruguai',
  'Ecuador': 'Equador',           'Paraguay': 'Paraguai',
  'Venezuela': 'Venezuela',       'Peru': 'Peru',
  'Bolivia': 'Bolívia',           'Chile': 'Chile',
  'Germany': 'Alemanha',          'France': 'França',
  'Spain': 'Espanha',             'England': 'Inglaterra',
  'Netherlands': 'Holanda',       'Belgium': 'Bélgica',
  'Italy': 'Itália',              'Croatia': 'Croácia',
  'Switzerland': 'Suíça',         'Denmark': 'Dinamarca',
  'Austria': 'Áustria',           'Serbia': 'Sérvia',
  'Poland': 'Polônia',            'Turkey': 'Turquia',
  'Greece': 'Grécia',             'Hungary': 'Húngria',
  'Czech Republic': 'República Tcheca', 'Czechia': 'República Tcheca',
  'Slovakia': 'Eslováquia',       'Romania': 'Romênia',
  'Ukraine': 'Ucrânia',           'Wales': 'País de Gales',
  'Algeria': 'Argélia',           'Egypt': 'Egito',
  'Nigeria': 'Nigéria',           'Senegal': 'Senegal',
  'Ghana': 'Gana',                'Cameroon': 'Camarões',
  'Tunisia': 'Tunísia',           "Ivory Coast": 'Costa do Marfim',
  "Côte d'Ivoire": 'Costa do Marfim', 'South Africa': 'África do Sul',
  'DR Congo': 'Congo',            'Democratic Republic of Congo': 'Congo',
  'Japan': 'Japão',               'South Korea': 'Coreia do Sul',
  'Korea Republic': 'Coreia do Sul', 'Saudi Arabia': 'Arábia Saudita',
  'Australia': 'Austrália',       'Iran': 'Irã',
  'Iraq': 'Iraque',               'Qatar': 'Catar',
  'China PR': 'China',            'Indonesia': 'Indonésia',
  'New Zealand': 'Nova Zelândia', 'Costa Rica': 'Costa Rica',
  'Honduras': 'Honduras',         'Panama': 'Panamá',
  'Jamaica': 'Jamaica',           'Haiti': 'Haiti',
  'Sweden': 'Suécia',             'Norway': 'Noruega',
  'Finland': 'Finlândia',         'Iceland': 'Islândia',
  'Ireland': 'Irlanda',           'Slovenia': 'Eslovênia',
  'Albania': 'Albânia',           'Georgia': 'Geórgia',
  'Israel': 'Israel',             'Cape Verde': 'Cabo Verde',
  'Cape Verde Islands': 'Cabo Verde',
  'Bosnia-Herzegovina': 'Bósnia e Herzegovina',
  'Bosnia and Herzegovina': 'Bósnia e Herzegovina',
  'Uzbekistan': 'Uzbequistão',    'Argentina': 'Argentina',
  'Portugal': 'Portugal',
};

function ptName(n) { return n ? (PT_NAMES[n] || n) : null; }

async function fetchJSON(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}: ${await r.text()}`);
  return r.json();
}

async function upsertTeam(name, flagUrl, hdr) {
  if (!name) return null;
  const rows = await fetchJSON(
    `${SUPA_REST}/teams?name=ilike.${encodeURIComponent(name)}&select=id&limit=1`,
    hdr
  );
  if (rows.length > 0) {
    if (flagUrl) {
      await fetch(`${SUPA_REST}/teams?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: { ...hdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ flag_url: flagUrl }),
      }).catch(() => {});
    }
    return rows[0].id;
  }
  const ins = await fetch(`${SUPA_REST}/teams`, {
    method: 'POST',
    headers: { ...hdr, Prefer: 'return=representation' },
    body: JSON.stringify({ name, flag_url: flagUrl || null }),
  });
  if (!ins.ok) throw new Error(`Erro ao criar time ${name}: ${await ins.text()}`);
  const created = await ins.json();
  return created[0]?.id ?? null;
}

async function main() {
  if (!SERVICE_KEY || !FD_KEY) {
    console.error('Faltam: SUPABASE_SERVICE_ROLE_KEY ou FOOTBALL_DATA_API_KEY');
    process.exit(1);
  }

  const hdr = {
    apikey:         SERVICE_KEY,
    Authorization:  `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  console.log(`[sync-bracket] ${new Date().toISOString()} — buscando FD...`);
  const { matches: allFd } = await fetchJSON(
    'https://api.football-data.org/v4/competitions/WC/matches',
    { 'X-Auth-Token': FD_KEY }
  );

  const fdKnockout = allFd.filter(m => KNOCKOUT_STAGES.has(m.stage));
  console.log(`[sync-bracket] FD knockout: ${fdKnockout.length} jogos`);

  // Carrega todos os mata-matas do Supabase
  const supaMatches = await fetchJSON(
    `${SUPA_REST}/matches?round=not.eq.GROUP&select=id,match_number,round,scheduled_at,home_team_id,away_team_id,status`,
    hdr
  );
  console.log(`[sync-bracket] Supabase knockout: ${supaMatches.length} jogos`);

  let updated = 0, skipped = 0;

  for (const fd of fdKnockout) {
    const round  = STAGE_ROUND[fd.stage];
    const fdTs   = new Date(fd.utcDate).getTime();
    const homePt = ptName(fd.homeTeam?.name);
    const awayPt = ptName(fd.awayTeam?.name);

    if (!homePt && !awayPt) { skipped++; continue; }

    // Busca no Supabase: match_number primeiro (mais confiável)
    let supa = supaMatches.find(m => fd.id && String(m.match_number) === String(fd.id));

    // Fallback: round + janela de 60 min (cobre diferenças de fuso do seed)
    if (!supa) {
      const cands = supaMatches.filter(m =>
        m.round === round &&
        Math.abs(new Date(m.scheduled_at).getTime() - fdTs) < 60 * 60 * 1000
      );
      // Se houver múltiplos candidatos, prefere o que já tem match_number definido
      supa = cands.find(m => m.match_number && m.match_number > 1000) ?? cands[0] ?? null;
    }

    if (!supa) {
      console.log(`  ⚠ Sem jogo: FD#${fd.id} ${homePt || '?'} × ${awayPt || '?'} (${round}, ${fd.utcDate})`);
      continue;
    }
    if (supa.status === 'FINISHED') continue;

    const homeId = homePt ? await upsertTeam(homePt, fd.homeTeam?.crest, hdr) : null;
    const awayId = awayPt ? await upsertTeam(awayPt, fd.awayTeam?.crest, hdr) : null;

    const patch = {
      match_number:     fd.id,
      home_team_id:     homeId,
      away_team_id:     awayId,
      home_placeholder: homeId ? null : 'A definir',
      away_placeholder: awayId ? null : 'A definir',
    };

    const pr = await fetch(`${SUPA_REST}/matches?id=eq.${supa.id}`, {
      method:  'PATCH',
      headers: { ...hdr, Prefer: 'return=minimal' },
      body:    JSON.stringify(patch),
    });

    if (pr.ok) {
      updated++;
      supa.match_number = fd.id; // evita pegar o mesmo registro duas vezes
      console.log(`  ✓ ${round}: ${homePt || 'TBD'} × ${awayPt || 'TBD'} (id=${supa.id})`);
    } else {
      console.error(`  ✗ Erro patch id=${supa.id}: ${await pr.text()}`);
    }
  }

  console.log(`[sync-bracket] Concluído: ${updated} atualizado(s), ${skipped} sem times ainda.`);
}

main().catch(err => { console.error(err); process.exit(1); });
