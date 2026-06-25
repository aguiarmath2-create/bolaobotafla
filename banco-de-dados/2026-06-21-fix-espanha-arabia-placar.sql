-- Fix: corrige placar Espanha x Arábia Saudita para o resultado oficial.
--
-- Problema: a API capturou o placar em 5x0 antes da anulação do gol no final.
-- O placar oficial final é 4x0.
--
-- Execute no SQL Editor do Supabase. Pode ser reexecutado com segurança.

-- ─── 1. Diagnóstico antes ─────────────────────────────────────────────────────
select
  m.id,
  m.match_number,
  ht.name as mandante,
  at.name as visitante,
  m.home_score,
  m.away_score,
  m.status,
  (select count(*) from public.predictions p where p.match_id = m.id) as total_palpites
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
where (lower(ht.name) ilike '%espan%' or lower(ht.name) ilike '%spain%')
  and (lower(at.name) ilike '%arabia%' or lower(at.name) ilike '%saudi%');

-- ─── 2. Atualiza o placar para 4x0 (FINISHED) ────────────────────────────────
-- O trigger trg_recalculate_match_predictions recalcula pontos automaticamente.
update public.matches
set home_score = 4,
    away_score = 0,
    status     = 'FINISHED'
where home_team_id = (
  select id from public.teams
  where lower(name) ilike '%espan%' or lower(name) ilike '%spain%'
  limit 1
)
and away_team_id = (
  select id from public.teams
  where lower(name) ilike '%arabia%' or lower(name) ilike '%saudi%'
  limit 1
);

-- ─── 3. Garante recálculo manual (caso o trigger não dispare) ─────────────────
update public.predictions p
set points_earned = public.fn_prediction_points(
  m.home_score,
  m.away_score,
  p.home_score,
  p.away_score
)
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
where m.id = p.match_id
  and m.status = 'FINISHED'
  and (lower(ht.name) ilike '%espan%' or lower(ht.name) ilike '%spain%')
  and (lower(at.name) ilike '%arabia%' or lower(at.name) ilike '%saudi%');

-- ─── 4. Confirmação ───────────────────────────────────────────────────────────
select
  m.id,
  ht.name as mandante,
  at.name as visitante,
  m.home_score,
  m.away_score,
  m.status,
  p.home_score as palpite_home,
  p.away_score as palpite_away,
  p.points_earned as pontos
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
left join public.predictions p on p.match_id = m.id
where (lower(ht.name) ilike '%espan%' or lower(ht.name) ilike '%spain%')
  and (lower(at.name) ilike '%arabia%' or lower(at.name) ilike '%saudi%')
order by p.points_earned desc;
