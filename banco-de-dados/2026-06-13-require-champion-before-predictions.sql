-- Palpites Spotx - exige selecao campea antes do primeiro palpite.
-- Execute no SQL Editor do Supabase apos criar champion_predictions.

create or replace function public.fn_validate_prediction_write()
returns trigger as $$
declare
  v_match public.matches%rowtype;
begin
  if new.user_id <> auth.uid() then
    raise exception 'Usuario invalido para este palpite.';
  end if;

  select * into v_match
  from public.matches
  where id = new.match_id;

  if not found then
    raise exception 'Partida nao encontrada.';
  end if;

  if v_match.league_id <> new.league_id then
    raise exception 'Partida nao pertence a esta liga.';
  end if;

  if not public.is_league_member(new.league_id, auth.uid()) then
    raise exception 'Usuario nao participa desta liga.';
  end if;

  if not exists (
    select 1
    from public.champion_predictions cp
    where cp.league_id = new.league_id
      and cp.user_id = auth.uid()
  ) then
    raise exception 'Escolha sua selecao campea antes de enviar palpites.';
  end if;

  if v_match.status <> 'UPCOMING' then
    raise exception 'Palpites fechados para esta partida.';
  end if;

  if v_match.home_team_id is null or v_match.away_team_id is null then
    raise exception 'Partida ainda nao definida para palpites.';
  end if;

  if v_match.prediction_opens_at is not null and now() < v_match.prediction_opens_at then
    raise exception 'Palpites ainda nao liberados para esta partida.';
  end if;

  if v_match.prediction_closes_at is not null and now() >= v_match.prediction_closes_at then
    raise exception 'Palpites fechados para esta partida.';
  end if;

  if tg_op = 'INSERT' then
    new.points_earned := 0;
  else
    new.points_earned := coalesce(old.points_earned, 0);
  end if;

  return new;
end;
$$ language plpgsql;
