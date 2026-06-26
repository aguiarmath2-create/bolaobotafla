// Vercel Serverless Function — sincroniza times das fases eliminatórias.
//
// Comportamento:
//   - Para jogos FD com times reais: upserta times e atualiza registro no Supabase.
//   - Para jogos FD com placeholders (Group X Winner, etc.): insere slot com "A definir"
//     se ainda não existir, mantendo todos os slots do bracket visíveis.
//   - Jogos já FINISHED não são alterados.
//   - Seguro de chamar repetidamente — idempotente.

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

const FD_STATUS = {
  FINISHED:  'FINISHED',
  IN_PLAY:   'LOCKED',
  PAUSED:    'LOCKED',
  TIMED:     'UPCOMING',
  SCHEDULED: 'UPCOMING',
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
  'Portugal': 'Portugal',         'Jordan': 'Jordânia',
  'Kosovo': 'Kosovo',
};

function ptName(n) { return n ? (PT_NAMES[n] || n) : null; }

// Detecta nomes placeholder que a FD usa para times ainda não definidos.
function isFdPlaceholder(name) {
  if (!name) return true;
  return /\b(winner|loser|2nd\s+place|3rd\s+place|third\s+place)\b/i.test(name) ||
         /^group\s+[a-l]\b/i.test(name) ||
         /^round\s+of\s+\d+\b/i.test(name) ||
         /^quarterfinal\s+\d+\b/i.test(name) ||
         /^semifinal\s+\d+\b/i.test(name);
}

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
    // Busca league_id para poder inserir novos registros
    const leagueRes = await fetch(`${SUPA}/leagues?select=id&limit=1`, { headers: hdr });
    if (!leagueRes.ok) return res.status(502).json({ error: `Supabase leagues: ${leagueRes.status}` });
    const leagues = await leagueRes.json();
    if (!leagues.length) return res.status(500).json({ error: 'Nenhuma liga no banco.' });
    const leagueId = leagues[0].id;

    // Busca todos os jogos da Copa no football-data.org
    const fdRes = await fetch(FD_URL, { headers: { 'X-Auth-Token': FD_KEY } });
    if (!fdRes.ok) {
      const txt = await fdRes.text();
      return res.status(502).json({ error: `football-data.org ${fdRes.status}: ${txt}` });
    }
    const { matches: allFd } = await fdRes.json();

    // Filtra apenas fases eliminatórias
    const fdKnockout = (allFd || []).filter(m => KNOCKOUT_STAGES.has(m.stage));

    // Carrega todos os jogos de mata-mata do Supabase
    const supaRes = await fetch(
      `${SUPA}/matches?round=not.eq.GROUP&select=id,match_number,round,scheduled_at,home_team_id,away_team_id,status`,
      { headers: hdr }
    );
    if (!supaRes.ok) {
      return res.status(502).json({ error: `Supabase select falhou: ${supaRes.status}` });
    }
    const supaMatches = await supaRes.json();

    const log = [];
    let updated = 0, inserted = 0, skipped = 0;

    for (const fd of fdKnockout) {
      const round   = STAGE_ROUND[fd.stage];
      const fdTs    = new Date(fd.utcDate).getTime();
      const homeRaw = fd.homeTeam?.name;
      const awayRaw = fd.awayTeam?.name;
      const homePt  = isFdPlaceholder(homeRaw) ? null : ptName(homeRaw);
      const awayPt  = isFdPlaceholder(awayRaw) ? null : ptName(awayRaw);

      // Busca no Supabase: match_number primeiro
      let supa = supaMatches.find(m => fd.id && String(m.match_number) === String(fd.id));
      if (!supa) {
        const cands = supaMatches.filter(m =>
          m.round === round &&
          Math.abs(new Date(m.scheduled_at).getTime() - fdTs) < 60 * 60 * 1000
        );
        supa = cands.find(m => m.match_number && m.match_number > 1000)
          ?? (cands.length > 0 ? cands[0] : null);
      }

      if (supa) {
        if (supa.status === 'FINISHED') {
          log.push(`— Finalizado, sem alteração: ${homePt || 'TBD'} × ${awayPt || 'TBD'}`);
          skipped++;
          continue;
        }

        // Sem mudança real: ambos placeholder e banco já reflete isso
        if (!homePt && !awayPt && !supa.home_team_id && !supa.away_team_id) {
          skipped++;
          continue;
        }

        const homeId = homePt ? await upsertTeam(homePt, fd.homeTeam?.crest, hdr) : null;
        const awayId = awayPt ? await upsertTeam(awayPt, fd.awayTeam?.crest, hdr) : null;

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
          supa.match_number  = fd.id;
          supa.home_team_id  = homeId;
          supa.away_team_id  = awayId;
        } else {
          const errTxt = await pr.text();
          log.push(`✗ Erro ao atualizar id=${supa.id}: ${errTxt}`);
        }

      } else {
        // Sem registro no Supabase — cria o slot do bracket
        const homeId = homePt ? await upsertTeam(homePt, fd.homeTeam?.crest, hdr) : null;
        const awayId = awayPt ? await upsertTeam(awayPt, fd.awayTeam?.crest, hdr) : null;
        const kickoff = new Date(fd.utcDate);
        const closes  = new Date(kickoff.getTime() - 60 * 60 * 1000).toISOString();
        const status  = FD_STATUS[fd.status] || 'UPCOMING';

        const newMatch = {
          league_id:            leagueId,
          match_number:         fd.id,
          home_team_id:         homeId,
          away_team_id:         awayId,
          home_placeholder:     homeId ? null : 'A definir',
          away_placeholder:     awayId ? null : 'A definir',
          scheduled_at:         fd.utcDate,
          round,
          status,
          prediction_opens_at:  new Date().toISOString(),
          prediction_closes_at: closes,
        };

        const ins = await fetch(`${SUPA}/matches`, {
          method:  'POST',
          headers: { ...hdr, Prefer: 'return=representation' },
          body:    JSON.stringify(newMatch),
        });

        if (ins.ok) {
          const created = await ins.json();
          supaMatches.push({ ...newMatch, id: created[0]?.id });
          inserted++;
          log.push(`+ inserido: ${homePt || 'A definir'} × ${awayPt || 'A definir'} (${round}, FD#${fd.id})`);
        } else {
          const errTxt = await ins.text();
          log.push(`✗ Erro ao inserir FD#${fd.id}: ${errTxt}`);
        }
      }
    }

    console.log(`[sync-bracket] fd_knockout=${fdKnockout.length} updated=${updated} inserted=${inserted} skipped=${skipped}`);
    return res.status(200).json({
      updated,
      inserted,
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

  const r = await fetch(
    `${SUPA}/teams?name=ilike.${encodeURIComponent(name)}&select=id&limit=1`,
    { headers: hdr }
  );
  if (r.ok) {
    const rows = await r.json();
    if (rows.length > 0) {
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
