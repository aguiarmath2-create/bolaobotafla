-- Diagnostico: pontuacao/ranking duplicado.
--
-- Este arquivo NAO altera dados. Execute no SQL Editor do Supabase para
-- identificar partidas marcadas como FINISHED por engano e pontos divergentes.

-- 1) Partidas finalizadas com mesmo horario e mesmo placar.
-- Se aparecerem jogos diferentes aqui, o sync antigo por scheduled_at/range
-- provavelmente marcou mais de uma partida com o mesmo resultado.
select
  m.scheduled_at,
  m.home_score,
  m.away_score,
  count(*) as partidas,
  string_agg(
    concat(m.id, ' #', coalesce(m.match_number::text, '?'), ' ', ht.name, ' x ', at.name),
    ' | '
    order by m.id
  ) as jogos
from public.matches m
left join public.teams ht on ht.id = m.home_team_id
left join public.teams at on at.id = m.away_team_id
where m.status = 'FINISHED'
group by m.scheduled_at, m.home_score, m.away_score
having count(*) > 1
order by m.scheduled_at;

-- 2) Partidas finalizadas em janela de 30 minutos com o mesmo placar.
-- Esta e a faixa que o endpoint antigo usava como fallback amplo.
select
  m1.id as match_id_1,
  concat(ht1.name, ' x ', at1.name) as jogo_1,
  m1.scheduled_at as horario_1,
  m2.id as match_id_2,
  concat(ht2.name, ' x ', at2.name) as jogo_2,
  m2.scheduled_at as horario_2,
  concat(m1.home_score, '-', m1.away_score) as placar
from public.matches m1
join public.matches m2
  on m1.id < m2.id
 and m1.status = 'FINISHED'
 and m2.status = 'FINISHED'
 and m1.home_score = m2.home_score
 and m1.away_score = m2.away_score
 and abs(extract(epoch from (m1.scheduled_at - m2.scheduled_at))) <= 1800
left join public.teams ht1 on ht1.id = m1.home_team_id
left join public.teams at1 on at1.id = m1.away_team_id
left join public.teams ht2 on ht2.id = m2.home_team_id
left join public.teams at2 on at2.id = m2.away_team_id
order by m1.scheduled_at, m1.id, m2.id;

-- 3) Pontos salvos diferentes do calculo oficial.
select
  p.id as prediction_id,
  p.user_id,
  pr.name as usuario,
  m.id as match_id,
  concat(ht.name, ' ', m.home_score, ' x ', m.away_score, ' ', at.name) as jogo,
  concat(p.home_score, ' x ', p.away_score) as palpite,
  p.points_earned as pontos_salvos,
  public.fn_prediction_points(m.home_score, m.away_score, p.home_score, p.away_score) as pontos_esperados
from public.predictions p
join public.matches m on m.id = p.match_id
left join public.profiles pr on pr.id = p.user_id
left join public.teams ht on ht.id = m.home_team_id
left join public.teams at on at.id = m.away_team_id
where m.status = 'FINISHED'
  and p.points_earned <> public.fn_prediction_points(m.home_score, m.away_score, p.home_score, p.away_score)
order by m.scheduled_at, pr.name;

-- 4) Ranking oficial atual usando somente partidas FINISHED do banco.
select
  pr.name as usuario,
  count(p.id) filter (where m.status = 'FINISHED') as palpites_finalizados,
  sum(coalesce(p.points_earned, 0)) filter (where m.status = 'FINISHED') as pontos
from public.league_members lm
join public.profiles pr on pr.id = lm.user_id
left join public.predictions p on p.league_id = lm.league_id and p.user_id = lm.user_id
left join public.matches m on m.id = p.match_id
group by pr.name
order by pontos desc nulls last, palpites_finalizados desc, pr.name;
