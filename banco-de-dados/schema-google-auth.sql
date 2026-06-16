-- ============================================================
-- Palpites entre Amigos - Schema Supabase com Google Auth
-- Regra: placar exato = 3 pts; resultado certo = 1 pt; erro = 0 pts.
-- ============================================================

create extension if not exists pgcrypto;

-- Perfil publico do usuario autenticado pelo Supabase Auth.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scoring_rules jsonb not null default '{"exact":3,"result":1,"miss":0}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'PLAYER' check (role in ('OWNER','ADMIN','PLAYER')),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.teams (
  id bigserial primary key,
  name text not null,
  flag_url text,
  group_name text
);

create table public.matches (
  id bigserial primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  match_number integer,
  home_team_id bigint references public.teams(id),
  away_team_id bigint references public.teams(id),
  home_placeholder text,
  away_placeholder text,
  home_score integer,
  away_score integer,
  scheduled_at timestamptz not null,
  round text not null check (round in ('GROUP','ROUND_OF_32','ROUND_OF_16','QUARTER','SEMI','THIRD','FINAL')),
  group_round integer check (group_round is null or group_round between 1 and 3),
  status text not null default 'DRAFT' check (status in ('DRAFT','UPCOMING','LOCKED','FINISHED')),
  prediction_opens_at timestamptz,
  prediction_closes_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.predictions (
  id bigserial primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id bigint not null references public.matches(id) on delete cascade,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  points_earned integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create table public.prizes (
  id bigserial primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  position integer not null,
  description text not null
);
create table public.champion_predictions (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id bigint not null references public.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index idx_league_members_user_id on public.league_members(user_id);
create index idx_matches_league_round on public.matches(league_id, round, group_round, scheduled_at);
create index idx_predictions_league_user on public.predictions(league_id, user_id);
create index idx_predictions_match_id on public.predictions(match_id);
create index idx_champion_predictions_team_id on public.champion_predictions(team_id);

create or replace function public.fn_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.fn_set_updated_at();

create trigger trg_predictions_updated_at
  before update on public.predictions
  for each row execute function public.fn_set_updated_at();
create trigger trg_champion_predictions_updated_at
  before update on public.champion_predictions
  for each row execute function public.fn_set_updated_at();
create or replace function public.fn_lock_champion_after_prediction()
returns trigger as $$
begin
  raise exception 'A selecao campea e definitiva e nao pode ser alterada.';
end;
$$ language plpgsql;

create trigger trg_lock_champion_after_prediction
  before update or delete on public.champion_predictions
  for each row execute function public.fn_lock_champion_after_prediction();

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

create or replace function public.is_league_member(p_league_id uuid, p_user_id uuid default auth.uid())
returns boolean as $$
begin
  return exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = p_user_id
  );
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.is_league_admin(p_league_id uuid, p_user_id uuid default auth.uid())
returns boolean as $$
begin
  return exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = p_user_id
      and lm.role in ('OWNER','ADMIN')
  );
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.handle_new_league()
returns trigger as $$
begin
  insert into public.league_members (league_id, user_id, role)
  values (new.id, new.owner_id, 'OWNER')
  on conflict (league_id, user_id) do update
    set role = 'OWNER';

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_league_created
  after insert on public.leagues
  for each row execute function public.handle_new_league();

create or replace function public.join_league_by_invite_code(p_invite_code text)
returns uuid as $$
declare
  v_league_id uuid;
begin
  select id into v_league_id
  from public.leagues
  where invite_code = p_invite_code;

  if v_league_id is null then
    raise exception 'Codigo de convite invalido.';
  end if;

  insert into public.league_members (league_id, user_id, role)
  values (v_league_id, auth.uid(), 'PLAYER')
  on conflict (league_id, user_id) do nothing;

  return v_league_id;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.profiles.name, excluded.name),
        avatar_url = excluded.avatar_url;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

create trigger trg_validate_prediction_write
  before insert or update on public.predictions
  for each row execute function public.fn_validate_prediction_write();

create or replace function public.fn_recalculate_match_predictions()
returns trigger as $$
begin
  if new.status = 'FINISHED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status
          or old.home_score is distinct from new.home_score
          or old.away_score is distinct from new.away_score) then
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

create trigger trg_recalculate_match_predictions
  after insert or update on public.matches
  for each row execute function public.fn_recalculate_match_predictions();

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.teams enable row level security;
alter table public.matches enable row level security;
alter table public.predictions enable row level security;
alter table public.prizes enable row level security;
alter table public.champion_predictions enable row level security;

create policy profiles_read_authenticated on public.profiles
  for select using (auth.uid() is not null);

create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy leagues_read_member on public.leagues
  for select using (public.is_league_member(id));

create policy leagues_create_authenticated on public.leagues
  for insert with check (owner_id = auth.uid());

create policy leagues_update_admin on public.leagues
  for update using (public.is_league_admin(id))
  with check (public.is_league_admin(id));

create policy league_members_read_member on public.league_members
  for select using (public.is_league_member(league_id));

create policy league_members_insert_admin on public.league_members
  for insert with check (public.is_league_admin(league_id));

create policy league_members_update_admin on public.league_members
  for update using (public.is_league_admin(league_id))
  with check (public.is_league_admin(league_id));

create policy teams_read_authenticated on public.teams
  for select using (auth.uid() is not null);

create policy matches_read_member on public.matches
  for select using (public.is_league_member(league_id));

create policy matches_manage_admin on public.matches
  for all using (public.is_league_admin(league_id))
  with check (public.is_league_admin(league_id));

create policy predictions_read_safe_direct on public.predictions
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.matches m
      where m.id = match_id
        and m.league_id = predictions.league_id
        and m.status = 'FINISHED'
        and public.is_league_member(m.league_id)
    )
  );

create policy predictions_self_insert on public.predictions
  for insert with check (user_id = auth.uid() and public.is_league_member(league_id));

create policy predictions_self_update on public.predictions
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_league_member(league_id));

create policy predictions_self_delete on public.predictions
  for delete using (user_id = auth.uid());

create policy prizes_read_member on public.prizes
  for select using (public.is_league_member(league_id));

create policy prizes_manage_admin on public.prizes
  for all using (public.is_league_admin(league_id))
  with check (public.is_league_admin(league_id));
create policy champion_predictions_read_member on public.champion_predictions
  for select using (public.is_league_member(league_id));

create policy champion_predictions_self_insert on public.champion_predictions
  for insert with check (user_id = auth.uid() and public.is_league_member(league_id));


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





