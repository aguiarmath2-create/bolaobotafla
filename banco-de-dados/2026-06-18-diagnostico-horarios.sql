-- Diagnóstico: lista todos os jogos de UMA LIGA com horário em Brasília (BRT, UTC-3).
-- Execute no SQL Editor do Supabase e compartilhe o resultado para identificar horários errados.
-- Ordem: data/hora crescente.

select
  m.id,
  m.match_number,
  m.league_id,
  m.round,
  m.group_round,
  ht.name                                                                         as mandante,
  at.name                                                                         as visitante,
  to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as horario_brasilia,
  to_char(m.scheduled_at,                                  'DD/MM/YYYY HH24:MI') as horario_utc,
  to_char(m.prediction_closes_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as fecha_palpites_brasilia,
  m.status,
  (select count(*) from public.predictions p where p.match_id = m.id)            as total_palpites
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
-- Para filtrar por uma liga específica, descomente a linha abaixo e coloque o league_id:
-- where m.league_id = 'SEU-LEAGUE-ID-AQUI'
order by m.league_id, m.scheduled_at;
