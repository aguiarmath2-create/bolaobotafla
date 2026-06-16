-- Palpites Spotx - RPC para entrar automaticamente na liga unica.
-- Execute no SQL Editor do Supabase apos o schema-google-auth.sql.

create or replace function public.auto_join_default_league()
returns uuid as $$
declare
  v_league_id uuid;
begin
  select league_id into v_league_id
  from public.league_members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if v_league_id is not null then
    return v_league_id;
  end if;

  select id into v_league_id
  from public.leagues
  order by created_at
  limit 1;

  if v_league_id is not null then
    insert into public.league_members (league_id, user_id, role)
    values (v_league_id, auth.uid(), 'PLAYER')
    on conflict (league_id, user_id) do nothing;
    return v_league_id;
  end if;

  insert into public.leagues (name, owner_id)
  values ('Palpites Spotx', auth.uid())
  returning id into v_league_id;

  return v_league_id;
end;
$$ language plpgsql security definer set search_path = public;

