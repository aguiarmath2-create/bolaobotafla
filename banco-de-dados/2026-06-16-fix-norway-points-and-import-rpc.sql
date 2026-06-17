-- Fix: recalcula pontos com placar final correto + corrige RPC de importacao.
--
-- Problema: ESPN marcou STATUS_END_PERIOD aos 90' com placar 1-3, disparando
-- FINISHED prematuramente. Quem palpitou 1x3 ganhou 3pts (exato). O jogo
-- continuou e terminou 1-4, mas os pontos nao foram recalculados.
--
-- Execute no SQL Editor do Supabase. Pode ser reexecutado com seguranca.

-- 1. Recalcula pontos de TODOS os jogos finalizados com placar oficial do banco.
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

-- 2. Zera pontos de partidas ainda nao finalizadas.
update public.predictions p
set points_earned = 0
from public.matches m
where m.id = p.match_id
  and m.status <> 'FINISHED'
  and p.points_earned <> 0;

-- 3. Confere: deve retornar zero linhas apos execucao.
select
  p.id            as prediction_id,
  p.user_id,
  m.home_score    as real_home,
  m.away_score    as real_away,
  p.home_score    as pred_home,
  p.away_score    as pred_away,
  p.points_earned as pontos_salvos,
  public.fn_prediction_points(m.home_score, m.away_score, p.home_score, p.away_score) as pontos_esperados
from public.predictions p
join public.matches m on m.id = p.match_id
where m.status = 'FINISHED'
  and m.home_score is not null
  and m.away_score is not null
  and p.points_earned <> public.fn_prediction_points(m.home_score, m.away_score, p.home_score, p.away_score);

-- 4. Corrige funcao import_copa_matches para gravar match_number no UPDATE
--    (antes so gravava no INSERT, causando falha no lookup por ID da API).
create or replace function public.import_copa_matches(
  p_league_id uuid,
  p_matches jsonb
)
returns integer as $$
declare
  v_home_id bigint;
  v_away_id bigint;
  v_match jsonb;
  v_existing_match_id bigint;
  v_changed integer := 0;
  v_num integer;
  v_status text;
  v_round text;
  v_group_round integer;
  v_home_score integer;
  v_away_score integer;
  v_scheduled_at timestamptz;
  v_match_number integer;
begin
  if auth.uid() is not null and not public.is_league_admin(p_league_id, auth.uid()) then
    raise exception 'Apenas o organizador da liga pode importar jogos.';
  end if;

  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'p_matches precisa ser um array JSON.';
  end if;

  for v_match in select * from jsonb_array_elements(p_matches) loop
    v_home_id := null;
    v_away_id := null;
    v_existing_match_id := null;

    if nullif(v_match->>'home', '') is null then
      continue;
    end if;

    v_scheduled_at := nullif(v_match->>'date', '')::timestamptz;
    if v_scheduled_at is null then
      continue;
    end if;

    v_match_number := nullif(v_match->>'match_number', '')::integer;

    select id into v_home_id
    from public.teams
    where lower(name) = lower(v_match->>'home')
    limit 1;

    if v_home_id is null then
      insert into public.teams (name, flag_url, group_name)
      values (v_match->>'home', nullif(v_match->>'home_flag', ''), nullif(v_match->>'group_name', ''))
      returning id into v_home_id;
    else
      update public.teams
      set flag_url = coalesce(nullif(v_match->>'home_flag', ''), flag_url),
          group_name = coalesce(nullif(v_match->>'group_name', ''), group_name)
      where id = v_home_id;
    end if;

    if nullif(v_match->>'away', '') is not null then
      select id into v_away_id
      from public.teams
      where lower(name) = lower(v_match->>'away')
      limit 1;

      if v_away_id is null then
        insert into public.teams (name, flag_url, group_name)
        values (v_match->>'away', nullif(v_match->>'away_flag', ''), nullif(v_match->>'group_name', ''))
        returning id into v_away_id;
      else
        update public.teams
        set flag_url = coalesce(nullif(v_match->>'away_flag', ''), flag_url),
            group_name = coalesce(nullif(v_match->>'group_name', ''), group_name)
        where id = v_away_id;
      end if;
    end if;

    v_status := public.normalize_match_status(v_match->>'status');
    v_round := public.normalize_match_round(v_match->>'round');
    v_group_round := nullif(v_match->>'group_round', '')::integer;
    v_home_score := nullif(v_match->>'home_score', '')::integer;
    v_away_score := nullif(v_match->>'away_score', '')::integer;

    -- Busca por match_number (ID oficial da API)
    if v_match_number is not null then
      select id into v_existing_match_id
      from public.matches
      where league_id = p_league_id
        and match_number = v_match_number
      limit 1;
    end if;

    -- Fallback: busca por times + data aproximada
    if v_existing_match_id is null then
      select id into v_existing_match_id
      from public.matches
      where league_id = p_league_id
        and home_team_id is not distinct from v_home_id
        and away_team_id is not distinct from v_away_id
        and abs(extract(epoch from (scheduled_at - v_scheduled_at))) < 1800
      limit 1;
    end if;

    if v_existing_match_id is not null then
      update public.matches
      set home_team_id          = v_home_id,
          away_team_id          = v_away_id,
          home_placeholder      = nullif(v_match->>'home_placeholder', ''),
          away_placeholder      = nullif(v_match->>'away_placeholder', ''),
          home_score            = v_home_score,
          away_score            = v_away_score,
          scheduled_at          = v_scheduled_at,
          round                 = v_round,
          group_round           = v_group_round,
          status                = v_status,
          -- Grava match_number (FD ID) no UPDATE tambem — corrige registros importados sem ele
          match_number          = coalesce(v_match_number, match_number),
          prediction_opens_at   = coalesce(prediction_opens_at, now()),
          prediction_closes_at  = coalesce(
            nullif(v_match->>'prediction_closes_at', '')::timestamptz,
            v_scheduled_at - interval '1 hour'
          )
      where id = v_existing_match_id;
    else
      select coalesce(max(match_number), 0) + 1
      into v_num
      from public.matches
      where league_id = p_league_id;

      insert into public.matches (
        league_id, match_number, home_team_id, away_team_id,
        home_placeholder, away_placeholder, home_score, away_score,
        scheduled_at, round, group_round, status,
        prediction_opens_at, prediction_closes_at
      ) values (
        p_league_id,
        coalesce(v_match_number, v_num),
        v_home_id, v_away_id,
        nullif(v_match->>'home_placeholder', ''),
        nullif(v_match->>'away_placeholder', ''),
        v_home_score, v_away_score,
        v_scheduled_at, v_round, v_group_round, v_status,
        coalesce(nullif(v_match->>'prediction_opens_at', '')::timestamptz, now()),
        coalesce(nullif(v_match->>'prediction_closes_at', '')::timestamptz, v_scheduled_at - interval '1 hour')
      );
    end if;

    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$ language plpgsql security definer set search_path = public;
