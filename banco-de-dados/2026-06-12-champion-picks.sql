-- Palpites Spotx - palpite de selecao campea por usuario e liga.
-- Execute no SQL Editor do Supabase em bancos ja existentes.
-- A escolha e definitiva: depois de criada, nao pode ser alterada/removida.

create table if not exists public.champion_predictions (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id bigint not null references public.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists idx_champion_predictions_team_id on public.champion_predictions(team_id);

alter table public.champion_predictions enable row level security;

drop trigger if exists trg_champion_predictions_updated_at on public.champion_predictions;
create trigger trg_champion_predictions_updated_at
  before update on public.champion_predictions
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_lock_champion_after_prediction()
returns trigger as $$
begin
  raise exception 'A selecao campea e definitiva e nao pode ser alterada.';
end;
$$ language plpgsql;

drop trigger if exists trg_lock_champion_after_prediction on public.champion_predictions;
create trigger trg_lock_champion_after_prediction
  before update or delete on public.champion_predictions
  for each row execute function public.fn_lock_champion_after_prediction();

drop policy if exists champion_predictions_read_member on public.champion_predictions;
create policy champion_predictions_read_member on public.champion_predictions
  for select using (public.is_league_member(league_id));

drop policy if exists champion_predictions_self_insert on public.champion_predictions;
create policy champion_predictions_self_insert on public.champion_predictions
  for insert with check (user_id = auth.uid() and public.is_league_member(league_id));

drop policy if exists champion_predictions_self_update on public.champion_predictions;
