-- Bolao do Neymar - corrige horarios dos jogos de 15/06/2026.
-- Horarios em Brasilia (BRT, UTC-3):
-- Espanha x Cabo Verde: 13:00
-- Belgica x Egito: 16:00
-- Arabia Saudita x Uruguai: 19:00
-- Ira x Nova Zelandia: 22:00
-- Rode este arquivo no SQL Editor do Supabase do Bolao do Neymar.

with fixes as (
  select * from (values
    ('es', 'cv', '2026-06-15 13:00:00-03'::timestamptz),
    ('be', 'eg', '2026-06-15 16:00:00-03'::timestamptz),
    ('sa', 'uy', '2026-06-15 19:00:00-03'::timestamptz),
    ('ir', 'nz', '2026-06-15 22:00:00-03'::timestamptz)
  ) as v(home_code, away_code, starts_at)
), updated as (
  update public.matches m
  set
    scheduled_at = f.starts_at,
    prediction_closes_at = f.starts_at - interval '1 hour',
    group_round = 1
  from public.teams ht,
       public.teams at,
       fixes f
  where ht.id = m.home_team_id
    and at.id = m.away_team_id
    and m.round = 'GROUP'
    and ht.flag_url like '%/' || f.home_code || '.png%'
    and at.flag_url like '%/' || f.away_code || '.png%'
  returning m.id
)
select count(*) as jogos_corrigidos from updated;

select
  m.id,
  ht.name as mandante,
  at.name as visitante,
  to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as horario_brasilia,
  to_char(m.prediction_closes_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as fecha_palpites_brasilia,
  m.group_round
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
where m.round = 'GROUP'
  and m.scheduled_at >= '2026-06-15 00:00:00-03'::timestamptz
  and m.scheduled_at < '2026-06-16 00:00:00-03'::timestamptz
order by m.scheduled_at;