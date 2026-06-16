-- Palpites Spotx - restringe leitura direta da tabela predictions.
-- O app deve ler `predictions_safe`, que mascara placares alheios antes do fim do jogo.

-- Evita que membros consultem a tabela base e vejam palpites alheios antes do encerramento.
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
