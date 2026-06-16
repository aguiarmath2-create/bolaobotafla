-- Palpites Spotx - RPC segura para semear jogos do Brasil.
-- Execute no SQL Editor do Supabase se o schema ja foi criado antes desta atualizacao.

create or replace function public.seed_league_matches(p_league_id uuid)
returns void as $$
declare
  v_existing integer;
  v_home_id bigint;
  v_away_id bigint;
  v_match jsonb;
  v_matches jsonb := '[
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","a":"Marrocos","af":"https://flagcdn.com/w80/ma.png","g":"C","dt":"2026-06-13T19:00:00-03:00","round":"GROUP","r":1,"status":"UPCOMING"},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","a":"Haiti","af":"https://flagcdn.com/w80/ht.png","g":"C","dt":"2026-06-19T22:00:00-03:00","round":"GROUP","r":2,"status":"UPCOMING"},
    {"h":"Escócia","hf":"https://flagcdn.com/w80/gb-sct.png","a":"Brasil","af":"https://flagcdn.com/w80/br.png","g":"C","dt":"2026-06-24T19:00:00-03:00","round":"GROUP","r":3,"status":"UPCOMING"},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","ap":"A definir","g":"Mata-mata","dt":"2026-06-29T19:00:00-03:00","round":"ROUND_OF_32","status":"LOCKED"},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","ap":"A definir","g":"Mata-mata","dt":"2026-07-04T19:00:00-03:00","round":"QUARTER","status":"LOCKED"},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","ap":"A definir","g":"Mata-mata","dt":"2026-07-08T19:00:00-03:00","round":"SEMI","status":"LOCKED"},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","ap":"A definir","g":"Mata-mata","dt":"2026-07-19T16:00:00-03:00","round":"FINAL","status":"LOCKED"}
  ]'::jsonb;
  v_idx integer := 0;
begin
  if not public.is_league_admin(p_league_id, auth.uid()) then
    raise exception 'Apenas o organizador da liga pode carregar jogos.';
  end if;

  select count(*) into v_existing from public.matches where league_id = p_league_id;
  if v_existing > 0 then
    return;
  end if;

  for v_match in select * from jsonb_array_elements(v_matches) loop
    v_home_id := null;
    v_away_id := null;

    insert into public.teams (name, flag_url, group_name)
    select v_match->>'h', v_match->>'hf', v_match->>'g'
    where not exists (select 1 from public.teams where name = v_match->>'h')
    returning id into v_home_id;
    if v_home_id is null then select id into v_home_id from public.teams where name = v_match->>'h' limit 1; end if;

    if v_match ? 'a' then
      insert into public.teams (name, flag_url, group_name)
      select v_match->>'a', v_match->>'af', v_match->>'g'
      where not exists (select 1 from public.teams where name = v_match->>'a')
      returning id into v_away_id;
      if v_away_id is null then select id into v_away_id from public.teams where name = v_match->>'a' limit 1; end if;
    end if;

    v_idx := v_idx + 1;
    insert into public.matches (
      league_id, match_number, home_team_id, away_team_id, away_placeholder,
      scheduled_at, round, group_round, status, prediction_opens_at, prediction_closes_at
    ) values (
      p_league_id, v_idx, v_home_id, v_away_id, v_match->>'ap',
      (v_match->>'dt')::timestamptz, v_match->>'round', nullif(v_match->>'r', '')::integer,
      v_match->>'status', now(), ((v_match->>'dt')::timestamptz - interval '1 hour')
    );
  end loop;
end;
$$ language plpgsql security definer set search_path = public;
