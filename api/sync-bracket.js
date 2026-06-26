// Vercel Serverless Function — sincroniza times das fases eliminatórias.
//
// Fonte: football-data.org (mesma do import-all-matches.js).
// Para cada jogo de mata-mata que a FD já tem times definidos, atualiza
// home_team_id / away_team_id no Supabase.
//
// Seguro de chamar repetidamente — idempotente.
// Chame via /api/sync-bracket (GET) a partir do painel admin.

const FD_URL  = 'https://api.football-data.org/v4/competitions/WC/matches';
const SUPA    = 'https://pmrbtugoyuwlgobovlzg.supabase.co/rest/v1';
const FD_KEY  = process.env.FOOTBALL_DATA_API_KEY;
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!FD_KEY || !SVC_KEY) {
    return res.status(500).json({ error: 'Faltam variáveis de ambiente: FOOTBALL_DATA_API_KEY ou SUPABASE_SERVICE_ROLE_KEY' });
  }

  const hdr = {
    apikey:         SVC_KEY,
    Authorization:  `Bearer ${SVC_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Busca todos os jogos da Copa no football-data.org
    const fdRes = await fetch(FD_URL, { headers: { 'X-Auth-Token': FD_KEY } });
    if (!fdRes.ok) {
      const txt = await fdRes.text();
      return res.status(502).json({ error: `football-data.org ${fdRes.status}: ${txt}` });
    }
    const { matches: allFd } = await fdRes.json();

    // 2. Filtra apenas fases eliminatórias
    const fdKnockout = (allFd || []).filter(m => KNOCKOUT_STAGES.has(m.stage));

    // 3. Carrega todos os jogos de mata-mata do Supabase de uma vez
    const supaRes = await fetch(
      `${SUPA}/matches?round=not.eq.GROUP&select=id,match_number,round,scheduled_at,home_team_id,away_team_id,status`,
      { headers: hdr }
    );
    if (!supaRes.ok) {
      return res.status(502).json({ error: `Supabase select falhou: ${supaRes.status}` });
    }
    const supaMatches = await supaRes.json();

    const log = [];
    let updated = 0;
    let skipped = 0;

    for (const fd of fdKnockout) {
      const round   = STAGE_ROUND[fd.stage];
      const fdTs    = new Date(fd.utcDate).getTime();
      const homePt  = ptName(fd.homeTeam?.name);
      const awayPt  = ptName(fd.awayTeam?.name);
      const homeReal = !!homePt;
      const awayReal = !!awayPt;

      // Pula se nenhum time está definido ainda
      if (!homeReal && !awayReal) {
        skipped++;
        continue;
      }

      // Encontra jogo no Supabase:
      // 1º por match_number (FD ID, mais confiável após o import inicial)
      // 2º por round + janela de 60 min (cobre diferenças de fuso do seed)
      let supa = supaMatches.find(m => fd.id && String(m.match_number) === String(fd.id));
      if (!supa) {
        const candidates = supaMatches.filter(m =>
          m.round === round &&
          Math.abs(new Date(m.scheduled_at).getTime() - fdTs) < 60 * 60 * 1000
        );
        // Se houver múltiplos candidatos (duplicatas), prefere o que já tem match_number da FD
        supa = candidates.find(m => m.match_number && m.match_number > 1000)
          ?? (candidates.length > 0 ? candidates[0] : null);
      }

      if (!supa) {
        log.push(`⚠ Sem jogo no banco para FD#${fd.id} (${homePt || '?'} × ${awayPt || '?'}, ${round}, ${fd.utcDate})`);
        continue;
      }

      // Não altera jogos já finalizados
      if (supa.status === 'FINISHED') {
        log.push(`— Finalizado, sem alteração: ${homePt || '?'} × ${awayPt || '?'} (id=${supa.id})`);
        continue;
      }

      // Upserta times reais no banco
      const homeId = homeReal ? await upsertTeam(homePt, fd.homeTeam?.crest, hdr) : null;
      const awayId = awayReal ? await upsertTeam(awayPt, fd.awayTeam?.crest, hdr) : null;

      const patch = {
        match_number:      fd.id,
        home_team_id:      homeId,
        away_team_id:      awayId,
        home_placeholder:  homeId ? null : 'A definir',
        away_placeholder:  awayId ? null : 'A definir',
      };

      const pr = await fetch(`${SUPA}/matches?id=eq.${supa.id}`, {
        method:  'PATCH',
        headers: { ...hdr, Prefer: 'return=minimal' },
        body:    JSON.stringify(patch),
      });

      if (pr.ok) {
        updated++;
        log.push(`✓ ${homePt || 'TBD'} × ${awayPt || 'TBD'} (${round}, id=${supa.id})`);
        // Sincroniza a cópia local para evitar reencontrar o mesmo registro
        supa.match_number  = fd.id;
        supa.home_team_id  = homeId;
        supa.away_team_id  = awayId;
      } else {
        const errTxt = await pr.text();
        log.push(`✗ Erro ao atualizar id=${supa.id}: ${errTxt}`);
      }
    }

    console.log(`[sync-bracket] fd_knockout=${fdKnockout.length} updated=${updated} skipped=${skipped}`);
    return res.status(200).json({
      updated,
      skipped,
      fd_knockout: fdKnockout.length,
      log,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Garante que o time existe na tabela teams. Retorna o ID.
async function upsertTeam(name, flagUrl, hdr) {
  if (!name) return null;

  // Tenta buscar pelo nome exato (case-insensitive)
  const r = await fetch(
    `${SUPA}/teams?name=ilike.${encodeURIComponent(name)}&select=id&limit=1`,
    { headers: hdr }
  );
  if (r.ok) {
    const rows = await r.json();
    if (rows.length > 0) {
      // Atualiza a bandeira se foi fornecida
      if (flagUrl) {
        await fetch(`${SUPA}/teams?id=eq.${rows[0].id}`, {
          method:  'PATCH',
          headers: { ...hdr, Prefer: 'return=minimal' },
          body:    JSON.stringify({ flag_url: flagUrl }),
        }).catch(() => {});
      }
      return rows[0].id;
    }
  }

  // Cria o time se não existir
  const ins = await fetch(`${SUPA}/teams`, {
    method:  'POST',
    headers: { ...hdr, Prefer: 'return=representation' },
    body:    JSON.stringify({ name, flag_url: flagUrl || null }),
  });
  if (ins.ok) {
    const rows = await ins.json();
    return rows[0]?.id ?? null;
  }
  return null;
}
