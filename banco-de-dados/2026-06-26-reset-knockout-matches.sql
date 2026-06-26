-- Reset limpo das fases eliminatórias.
--
-- Problema: import-all-matches.js importou nomes placeholder da FD como se
-- fossem times reais ("Group C Winner", "Round of 32 1 Winner", etc.), criando
-- times fantasmas e jogos duplicados quando a FD atualizou com times reais.
--
-- Solução: apaga todos os jogos de mata-mata (0 palpites = seguro) e times
-- fantasmas que não têm mais jogos vinculados. Em seguida reimporta via script
-- corrigido que ignora nomes placeholder.
--
-- Execute no SQL Editor do Supabase na ordem abaixo.

-- ─── 1. Verificação: quantos palpites existem em jogos de mata-mata ──────────
-- Deve retornar 0. Se retornar > 0, NÃO execute os passos seguintes.
SELECT COUNT(*) AS palpites_em_matamata
FROM public.predictions p
JOIN public.matches m ON m.id = p.match_id
WHERE m.round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL');

-- ─── 2. Apaga jogos de mata-mata ─────────────────────────────────────────────
-- SÓ execute após confirmar que palpites_em_matamata = 0
DELETE FROM public.matches
WHERE round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL');

-- ─── 3. Remove times fantasmas (sem nenhum jogo vinculado) ───────────────────
-- Apaga times como "Group C Winner", "Round of 32 1 Winner", etc.
DELETE FROM public.teams
WHERE id NOT IN (
  SELECT home_team_id FROM public.matches WHERE home_team_id IS NOT NULL
  UNION
  SELECT away_team_id FROM public.matches WHERE away_team_id IS NOT NULL
);

-- ─── 4. Verificação final ────────────────────────────────────────────────────
SELECT COUNT(*) AS jogos_matamata_restantes
FROM public.matches
WHERE round IN ('ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL');

SELECT COUNT(*) AS total_times FROM public.teams;
