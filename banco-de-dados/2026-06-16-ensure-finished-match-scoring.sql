-- Garantia: pontuacao oficial apos partida FINISHED.
--
-- Regra:
--   placar exato      = 3 pontos
--   vencedor/empate   = 1 ponto
--   erro              = 0 pontos
--
-- Execute no SQL Editor do Supabase. Pode ser reexecutado com seguranca.

create or replace function public.fn_prediction_points(
  real_home integer,
  real_away integer,
  pred_home integer,
  pred_away integer
)
returns integer as $$
begin
  if real_home is null or real_away is null then
    return 0;
  end if;

  if real_home = pred_home and real_away = pred_away then
    return 3;
  end if;

  if sign(real_home - real_away) = sign(pred_home - pred_away) then
    return 1;
  end if;

  return 0;
end;
$$ language plpgsql immutable;

create or replace function public.fn_recalculate_match_predictions()
returns trigger as $$
begin
  if new.status = 'FINISHED'
     and new.home_score is not null
     and new.away_score is not null
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.home_score is distinct from new.home_score
       or old.away_score is distinct from new.away_score
     ) then
    update public.predictions
    set points_earned = public.fn_prediction_points(
      new.home_score,
      new.away_score,
      home_score,
      away_score
    )
    where match_id = new.id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_recalculate_match_predictions on public.matches;
create trigger trg_recalculate_match_predictions
  after insert or update on public.matches
  for each row execute function public.fn_recalculate_match_predictions();

-- Recalcula tudo que ja esta finalizado, caso algum ponto antigo tenha ficado errado.
update public.predictions p
set points_earned = public.fn_prediction_points(
  m.home_score,
  m.away_score,
  p.home_score,
  p.away_score
)
from public.matches m
where m.id = p.match_id
  and m.status = 'FINISHED'
  and m.home_score is not null
  and m.away_score is not null;

-- Zera qualquer ponto salvo em partidas que ainda nao terminaram.
update public.predictions p
set points_earned = 0
from public.matches m
where m.id = p.match_id
  and m.status <> 'FINISHED'
  and p.points_earned <> 0;

-- Conferencia: deve retornar zero linhas.
select
  p.id as prediction_id,
  p.user_id,
  m.id as match_id,
  p.points_earned as pontos_salvos,
  public.fn_prediction_points(m.home_score, m.away_score, p.home_score, p.away_score) as pontos_esperados
from public.predictions p
join public.matches m on m.id = p.match_id
where m.status = 'FINISHED'
  and m.home_score is not null
  and m.away_score is not null
  and p.points_earned <> public.fn_prediction_points(m.home_score, m.away_score, p.home_score, p.away_score);
