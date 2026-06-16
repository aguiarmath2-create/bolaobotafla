-- Palpites Spotx - diagnostico rapido do Supabase.
-- Rode no SQL Editor para entender se o banco esta pronto para o app.

select
  'matches_total' as check_name,
  count(*)::text as value
from public.matches;

select
  'teams_total' as check_name,
  count(*)::text as value
from public.teams;

select
  'predictions_total' as check_name,
  count(*)::text as value
from public.predictions;

select
  'champion_predictions_table_exists' as check_name,
  to_regclass('public.champion_predictions')::text as value;

select
  'import_copa_matches_rpc_exists' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'import_copa_matches'
  )::text as value;

select
  round,
  group_round,
  status,
  count(*) as total
from public.matches
group by round, group_round, status
order by round, group_round, status;

select
  m.id,
  m.match_number,
  m.round,
  m.group_round,
  m.status,
  m.scheduled_at,
  ht.name as home_team,
  at.name as away_team,
  m.away_placeholder,
  m.home_score,
  m.away_score
from public.matches m
left join public.teams ht on ht.id = m.home_team_id
left join public.teams at on at.id = m.away_team_id
order by m.scheduled_at
limit 20;

