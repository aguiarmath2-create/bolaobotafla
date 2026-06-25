-- Diagnóstico: jogos que já deveriam ter placar mas ainda estão sem FINISHED no banco.
-- Execute no SQL Editor do Supabase para identificar o que precisa de sync manual.

-- ─── 1. Jogos passados sem placar ─────────────────────────────────────────────
select
  m.id,
  m.match_number,
  ht.name as mandante,
  at.name as visitante,
  to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as horario_brt,
  m.status,
  m.home_score,
  m.away_score,
  (select count(*) from public.predictions p where p.match_id = m.id) as palpites
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
where m.scheduled_at < now() - interval '3 hours'   -- encerrado há pelo menos 3h
  and (m.status <> 'FINISHED' or m.home_score is null or m.away_score is null)
order by m.scheduled_at;

-- ─── 2. Forçar placar manualmente (editar valores abaixo) ─────────────────────
-- Se o GH Actions não resolver um jogo específico, atualize aqui com o placar correto.
-- Substitua <id>, <gols_mandante> e <gols_visitante> pelos valores reais.
--
-- update public.matches
-- set status = 'FINISHED',
--     home_score = <gols_mandante>,
--     away_score = <gols_visitante>
-- where id = <id>
--   and status <> 'FINISHED';  -- proteção contra sobrescrever correções

-- ─── 3. Recalcula pontos de todos os jogos finalizados ────────────────────────
-- Use após qualquer correção manual para garantir que os pontos estão corretos.
--
-- update public.predictions p
-- set points_earned = public.fn_prediction_points(
--   m.home_score, m.away_score, p.home_score, p.away_score
-- )
-- from public.matches m
-- where m.id = p.match_id
--   and m.status = 'FINISHED'
--   and m.home_score is not null
--   and m.away_score is not null;
