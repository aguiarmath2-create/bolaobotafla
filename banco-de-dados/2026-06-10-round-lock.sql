-- Palpites Spotx - Bloqueio por rodada.
-- Rodada 2 so abre quando todos os jogos da Rodada 1 terminarem, e assim por diante.
-- Execute no SQL Editor do Supabase.

-- 1. Remove palpites ja feitos nas Rodadas 2 e 3 (feitos antes da regra existir)
delete from public.predictions
where match_id in (
  select id from public.matches where group_round in (2, 3)
);

-- 2. Bloqueia Rodadas 2 e 3 (apenas jogos ainda nao finalizados)
update public.matches
set prediction_opens_at = '2099-01-01 00:00:00+00'
where group_round in (2, 3)
  and status = 'UPCOMING';

-- 2. Funcao: quando o ultimo jogo da rodada N termina, desbloqueia a rodada N+1
create or replace function public.fn_unlock_next_round()
returns trigger as $$
declare
  v_total    integer;
  v_finished integer;
begin
  -- So age quando a partida muda para FINISHED
  if new.status != 'FINISHED' or old.status = 'FINISHED' then
    return new;
  end if;

  select count(*) into v_total
  from public.matches
  where league_id = new.league_id and group_round = new.group_round;

  select count(*) into v_finished
  from public.matches
  where league_id = new.league_id
    and group_round = new.group_round
    and status = 'FINISHED';

  -- Se todos os jogos da rodada terminaram, desbloqueia a proxima
  if v_total = v_finished then
    update public.matches
    set prediction_opens_at = now()
    where league_id = new.league_id
      and group_round = new.group_round + 1
      and prediction_opens_at > now();
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 3. Cria o trigger
drop trigger if exists trg_unlock_next_round on public.matches;
create trigger trg_unlock_next_round
  after update on public.matches
  for each row execute function public.fn_unlock_next_round();

