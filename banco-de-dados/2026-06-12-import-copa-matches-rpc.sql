-- Palpites Spotx - RPC para importar/atualizar jogos da Copa 2026.
-- Este SQL NAO busca a ESPN sozinho: ele recebe um JSON do frontend/servidor
-- e grava os jogos no Supabase sem apagar palpites existentes.
--
-- Use depois do schema principal. Pode ser reexecutado com seguranca.

create or replace function public.normalize_match_round(p_round text)
returns text as $$
declare
  v text := upper(coalesce(trim(p_round), ''));
begin
  if v in ('GROUP', 'GROUP_STAGE', 'FASE DE GRUPOS', 'FASE_GRUPOS') then
    return 'GROUP';
  elsif v in ('ROUND_OF_32', 'R32', 'DEZESSEIS_AVOS', 'DEZESSEIS AVOS', '32') then
    return 'ROUND_OF_32';
  elsif v in ('ROUND_OF_16', 'R16', 'OITAVAS', 'OITAVAS DE FINAL', '16') then
    return 'ROUND_OF_16';
  elsif v in ('QUARTER', 'QUARTERS', 'QUARTER_FINAL', 'QUARTAS', 'QUARTAS DE FINAL') then
    return 'QUARTER';
  elsif v in ('SEMI', 'SEMIFINAL', 'SEMI_FINAL', 'SEMIFINAIS') then
    return 'SEMI';
  elsif v in ('THIRD', 'THIRD_PLACE', 'TERCEIRO', '3 LUGAR', '3O LUGAR') then
    return 'THIRD';
  elsif v in ('FINAL') then
    return 'FINAL';
  end if;

  return 'GROUP';
end;
$$ language plpgsql immutable;

create or replace function public.normalize_match_status(p_status text)
returns text as $$
declare
  v text := upper(coalesce(trim(p_status), ''));
begin
  if v in ('FINISHED', 'FINAL', 'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FT') then
    return 'FINISHED';
  elsif v in ('LOCKED', 'IN_PLAY', 'LIVE', 'PAUSED', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME') then
    return 'LOCKED';
  elsif v in ('DRAFT') then
    return 'DRAFT';
  end if;

  return 'UPCOMING';
end;
$$ language plpgsql immutable;

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
begin
  -- No app, somente organizador/admin importa. No SQL Editor, auth.uid()
  -- costuma ser null, entao permitimos execucao manual pelo dono do projeto.
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

    -- Primeiro tenta achar por numero oficial do jogo.
    if nullif(v_match->>'match_number', '') is not null then
      select id into v_existing_match_id
      from public.matches
      where league_id = p_league_id
        and match_number = (v_match->>'match_number')::integer
      limit 1;
    end if;

    -- Se nao tiver numero, tenta achar por times e data aproximada.
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
      set home_team_id = v_home_id,
          away_team_id = v_away_id,
          home_placeholder = nullif(v_match->>'home_placeholder', ''),
          away_placeholder = nullif(v_match->>'away_placeholder', ''),
          home_score = v_home_score,
          away_score = v_away_score,
          scheduled_at = v_scheduled_at,
          round = v_round,
          group_round = v_group_round,
          status = v_status,
          prediction_opens_at = coalesce(prediction_opens_at, now()),
          prediction_closes_at = coalesce(
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
        league_id,
        match_number,
        home_team_id,
        away_team_id,
        home_placeholder,
        away_placeholder,
        home_score,
        away_score,
        scheduled_at,
        round,
        group_round,
        status,
        prediction_opens_at,
        prediction_closes_at
      ) values (
        p_league_id,
        coalesce(nullif(v_match->>'match_number', '')::integer, v_num),
        v_home_id,
        v_away_id,
        nullif(v_match->>'home_placeholder', ''),
        nullif(v_match->>'away_placeholder', ''),
        v_home_score,
        v_away_score,
        v_scheduled_at,
        v_round,
        v_group_round,
        v_status,
        coalesce(nullif(v_match->>'prediction_opens_at', '')::timestamptz, now()),
        coalesce(nullif(v_match->>'prediction_closes_at', '')::timestamptz, v_scheduled_at - interval '1 hour')
      );
    end if;

    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$ language plpgsql security definer set search_path = public;

