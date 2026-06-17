-- Suporte a múltiplas ligas com acesso por código + senha.
--
-- 1. Cria a liga "Bolão do Rafaiol" com o mesmo dono do BotaFla.
-- 2. Corrige auto_join_default_league: retorna null para usuários novos
--    em vez de auto-adicionar na primeira liga do banco.
--
-- Execute no SQL Editor do Supabase. Pode ser reexecutado com segurança.

-- Liga do Rafaiol
insert into public.leagues (name, invite_code, owner_id, scoring_rules)
select
  'Bolão do Rafaiol',
  '2964427416ab',
  owner_id,
  '{"exact":3,"result":1,"miss":0}'::jsonb
from public.leagues
where name = 'BotaFla'
limit 1
on conflict (invite_code) do nothing;

-- Corrige a função de roteamento
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

  return v_league_id; -- null se o usuário não estiver em nenhuma liga
end;
$$ language plpgsql security definer set search_path = public;
