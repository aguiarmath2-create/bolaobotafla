-- Fix: predictions_safe nao deve expor pontos antes do status FINISHED.
--
-- Antes, a view retornava p.points_earned depois de 135 minutos mesmo quando
-- matches.status ainda nao era FINISHED. Se algum points_earned antigo/stale
-- existisse, o front podia contar pontos em partidas nao finalizadas.
--
-- Execute no SQL Editor do Supabase (uma unica vez).

create or replace view public.predictions_safe as
select
  p.id,
  p.league_id,
  p.user_id,
  p.match_id,
  case
    when p.user_id = auth.uid()                           then p.home_score
    when m.status = 'FINISHED'                            then p.home_score
    when now() > m.scheduled_at + interval '135 minutes' then p.home_score
    else null
  end as home_score,
  case
    when p.user_id = auth.uid()                           then p.away_score
    when m.status = 'FINISHED'                            then p.away_score
    when now() > m.scheduled_at + interval '135 minutes' then p.away_score
    else null
  end as away_score,
  case
    when m.status = 'FINISHED' then p.points_earned
    else 0
  end as points_earned,
  p.created_at,
  p.updated_at
from public.predictions p
join public.matches m on m.id = p.match_id
where public.is_league_member(p.league_id);

grant select on public.predictions_safe to authenticated;
