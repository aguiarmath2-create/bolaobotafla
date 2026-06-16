-- Palpites Spotx - permite o proprio usuario garantir o proprio profile.
-- Seguro porque o id precisa ser exatamente auth.uid().

alter table public.profiles enable row level security;

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());

