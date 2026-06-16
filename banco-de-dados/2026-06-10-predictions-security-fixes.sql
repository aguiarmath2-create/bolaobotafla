-- Palpites Spotx - Correcoes de seguranca nos palpites.
-- Execute no SQL Editor do Supabase apos o schema-google-auth.sql.

-- Fix 1: View que mascara home_score/away_score de outros usuarios ate o jogo terminar.
-- Impede que membros vejam palpites alheios antes do encerramento via chamada direta a API.
-- A clausula WHERE replica a protecao RLS da tabela base (is_league_member).
create or replace view public.predictions_safe as
select
  p.id,
  p.league_id,
  p.user_id,
  p.match_id,
  case
    when p.user_id = auth.uid() then p.home_score
    when m.status = 'FINISHED'  then p.home_score
    else null
  end as home_score,
  case
    when p.user_id = auth.uid() then p.away_score
    when m.status = 'FINISHED'  then p.away_score
    else null
  end as away_score,
  case
    when m.status = 'FINISHED' then p.points_earned
    else 0
  end as points_earned,
  p.created_at,
  p.updated_at
from public.predictions p
join public.matches m on m.id = p.match_id
where public.is_league_member(p.league_id);

grant select on public.predictions_safe to authenticated;

-- Fix 2: Impede delecao de palpites depois que a partida foi finalizada.
-- Sem este fix, um usuario poderia deletar palpites com pontos ja calculados.
drop policy if exists predictions_self_delete on public.predictions;
create policy predictions_self_delete on public.predictions
  for delete using (
    user_id = auth.uid()
    and (
      select status from public.matches where id = match_id
    ) != 'FINISHED'
  );


-- Fix 3: restringe leitura direta da tabela base; use predictions_safe para contagens/mascara.
drop policy if exists predictions_read_member on public.predictions;
drop policy if exists predictions_read_safe_direct on public.predictions;
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

