-- Remove duplicatas nos jogos de mata-mata.
--
-- Causa: seed_league_matches usou horários em -03:00, mas import-all-matches.js
-- importou da FD em UTC — a diferença de fuso impediu o match por ±30 min
-- e criou novos jogos em vez de atualizar os existentes.
--
-- Estratégia: para cada (round, dia BRT), mantém o jogo com MAIS palpites;
-- em caso de empate, mantém o de maior ID (mais recente/correto da FD).
-- O outro é deletado junto com seus palpites.
--
-- Execute no SQL Editor do Supabase ANTES de fazer deploy.

-- ─── 1. Preview: quais serão mantidos e quais serão deletados ───────────────
WITH ranked AS (
  SELECT
    m.id,
    m.round,
    m.match_number,
    to_char(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS horario_brt,
    COALESCE(ht.name, m.home_placeholder, '—') AS mandante,
    COALESCE(at.name, m.away_placeholder, '—') AS visitante,
    m.status,
    (SELECT COUNT(*) FROM public.predictions p WHERE p.match_id = m.id) AS palpites,
    ROW_NUMBER() OVER (
      PARTITION BY m.round,
                   date_trunc('day', m.scheduled_at AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY
        (SELECT COUNT(*) FROM public.predictions p WHERE p.match_id = m.id) DESC,
        m.id DESC  -- maior ID = criado mais recentemente (pela FD import)
    ) AS rn
  FROM public.matches m
  LEFT JOIN public.teams ht ON ht.id = m.home_team_id
  LEFT JOIN public.teams at ON at.id = m.away_team_id
  WHERE m.round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL')
)
SELECT
  id, round, horario_brt, mandante, visitante,
  palpites,
  CASE WHEN rn = 1 THEN 'MANTER' ELSE 'DELETAR' END AS acao
FROM ranked
ORDER BY round, horario_brt, rn;

-- ─── 2. DELETE: remove as duplicatas ────────────────────────────────────────
-- Descomente e execute apenas após confirmar o preview acima.

/*
WITH ranked AS (
  SELECT
    m.id,
    ROW_NUMBER() OVER (
      PARTITION BY m.round,
                   date_trunc('day', m.scheduled_at AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY
        (SELECT COUNT(*) FROM public.predictions p WHERE p.match_id = m.id) DESC,
        m.id DESC
    ) AS rn
  FROM public.matches m
  WHERE m.round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL')
)
DELETE FROM public.matches
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
*/

-- ─── 3. Verificação final ────────────────────────────────────────────────────
-- Execute após o DELETE para confirmar que não há mais duplicatas.
/*
SELECT
  m.round,
  m.match_number,
  to_char(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS horario_brt,
  COALESCE(ht.name, m.home_placeholder, 'A definir') AS mandante,
  COALESCE(at.name, m.away_placeholder, 'A definir') AS visitante,
  m.status
FROM public.matches m
LEFT JOIN public.teams ht ON ht.id = m.home_team_id
LEFT JOIN public.teams at ON at.id = m.away_team_id
WHERE m.round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL')
ORDER BY m.scheduled_at;
*/
