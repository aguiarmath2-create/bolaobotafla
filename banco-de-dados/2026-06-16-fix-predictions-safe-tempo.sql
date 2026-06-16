-- Fix: predictions_safe revela placares dos outros usuarios apos 135 min do inicio da partida.
-- Sem isso, o placar so aparece quando m.status = 'FINISHED' no banco, que depende do
-- supabasePatch funcionar. Com esta mudanca, o site mostra os palpites automaticamente
-- pelo horario mesmo que o banco ainda nao tenha sido atualizado.
--
-- Execute no SQL Editor do Supabase (uma unica vez).

create or replace view public.predictions_safe as
select
  p.id,
  p.league_id,
  p.user_id,
  p.match_id,
  case
    when p.user_id = auth.uid()                                     then p.home_score
    when m.status = 'FINISHED'                                      then p.home_score
    when now() > m.scheduled_at + interval '135 minutes'           then p.home_score
    else null
  end as home_score,
  case
    when p.user_id = auth.uid()                                     then p.away_score
    when m.status = 'FINISHED'                                      then p.away_score
    when now() > m.scheduled_at + interval '135 minutes'           then p.away_score
    else null
  end as away_score,
  case
    when m.status = 'FINISHED'                                      then p.points_earned
    when now() > m.scheduled_at + interval '135 minutes'           then p.points_earned
    else 0
  end as points_earned,
  p.created_at,
  p.updated_at
from public.predictions p
join public.matches m on m.id = p.match_id
where public.is_league_member(p.league_id);

grant select on public.predictions_safe to authenticated;
