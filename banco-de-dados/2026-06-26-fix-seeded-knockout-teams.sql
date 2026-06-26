-- Diagnóstico e correção dos jogos de mata-mata pre-semeados incorretamente.
--
-- O RPC seed_league_matches criou jogos de QUARTER/SEMI/FINAL com Brasil como
-- mandante e "A definir" como visitante. Isso causava o Brasil aparecer em todas
-- as fases no bracket mesmo sem ter avançado.
--
-- Este script:
--   1. Mostra o estado atual dos jogos de mata-mata.
--   2. Remove o Brasil pré-semeado de QUARTER/SEMI/FINAL que ainda não foram
--      determinados pelo torneio.
--   3. A sincronização real vem de /api/sync-bracket que consulta o football-data.org.
--
-- Execute no SQL Editor do Supabase ANTES de chamar /api/sync-bracket.

-- ─── 1. Diagnóstico: estado atual do mata-mata ──────────────────────────────
SELECT
  m.round,
  m.match_number,
  to_char(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS horario_brt,
  COALESCE(ht.name, m.home_placeholder, '—') AS mandante,
  COALESCE(at.name, m.away_placeholder, '—') AS visitante,
  m.status
FROM public.matches m
LEFT JOIN public.teams ht ON ht.id = m.home_team_id
LEFT JOIN public.teams at ON at.id = m.away_team_id
WHERE m.round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL')
ORDER BY m.scheduled_at;

-- ─── 2. Limpeza: remove Brasil pré-semeado de QUARTER/SEMI/FINAL ────────────
-- Condição conservadora: só altera se:
--   - Fase ainda não disputada (não FINISHED)
--   - Mandante é Brasil
--   - Visitante ainda não definido (apenas placeholder, sem time real)
-- Isso evita alterar jogos reais onde o Brasil de fato avançou.

UPDATE public.matches m
SET
  home_team_id     = NULL,
  home_placeholder = 'A definir'
WHERE m.round IN ('QUARTER', 'SEMI', 'FINAL')
  AND m.status     != 'FINISHED'
  AND m.away_team_id IS NULL
  AND m.home_team_id = (
    SELECT id FROM public.teams WHERE lower(name) = 'brasil' LIMIT 1
  );

-- ─── 3. Verificação pós-correção ────────────────────────────────────────────
SELECT
  m.round,
  to_char(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS horario_brt,
  COALESCE(ht.name, m.home_placeholder, 'A definir') AS mandante,
  COALESCE(at.name, m.away_placeholder, 'A definir') AS visitante,
  m.status
FROM public.matches m
LEFT JOIN public.teams ht ON ht.id = m.home_team_id
LEFT JOIN public.teams at ON at.id = m.away_team_id
WHERE m.round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL')
ORDER BY m.scheduled_at;
