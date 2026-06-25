-- Fix: placar Espanha 4x0 Arábia Saudita + remove jogo duplicado (id=104).
--
-- Contexto: football-data.org retorna 5x0 incorretamente (gol anulado pela VAR).
--           Placar oficial (FIFA/Google) é 4x0.
--           live.js foi corrigido para não sobrescrever partidas já FINISHED.
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
where m.id in (43, 104)
order by m.id;

-- ─── 2. Remove duplicata (id=104) e migra palpite ────────────────────────────
do $$
declare
  v_keep_id  bigint := 43;
  v_drop_id  bigint := 104;
  v_migrated integer;
begin
  -- Migra palpite do id=104 apenas se o usuário ainda não tem palpite no id=43
  update public.predictions
  set match_id = v_keep_id
  where match_id = v_drop_id
    and user_id not in (
      select user_id from public.predictions where match_id = v_keep_id
    );

  get diagnostics v_migrated = row_count;
  raise notice 'Palpites migrados de id=% para id=%: %', v_drop_id, v_keep_id, v_migrated;

  delete from public.predictions where match_id = v_drop_id;
  delete from public.matches     where id       = v_drop_id;

  raise notice 'Duplicado id=% removido.', v_drop_id;
end;
$$;

-- ─── 3. Corrige placar para 4x0 (placar oficial FIFA) ────────────────────────
update public.matches
set home_score = 4,
    away_score = 0,
    status     = 'FINISHED'
where id = 43;

-- ─── 4. Recalcula pontos com placar 4x0 ──────────────────────────────────────
update public.predictions p
set points_earned = public.fn_prediction_points(4, 0, p.home_score, p.away_score)
where p.match_id = 43;

-- ─── 5. Confirmação ───────────────────────────────────────────────────────────
select
  m.id,
  ht.name        as mandante,
  at.name        as visitante,
  m.home_score,
  m.away_score,
  m.status,
  p.home_score   as palpite_home,
  p.away_score   as palpite_away,
  p.points_earned as pontos
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
left join public.predictions p on p.match_id = m.id
where m.id = 43
order by p.points_earned desc;
