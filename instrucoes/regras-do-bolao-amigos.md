# Regras do Palpites Spotx

## Criterio de pontuacao

- **3 pontos**: acerto do placar exato.
- **1 ponto**: acerto do resultado da partida, sem placar exato.
- **0 pontos**: erro do resultado da partida.

A pontuacao nao e acumulativa. Quem acerta o placar exato recebe 3 pontos no total, pois o resultado ja esta incluido nesse acerto.

## Exemplos

- Resultado real `2 x 0`, palpite `2 x 0`: **3 pontos**.
- Resultado real `2 x 0`, palpite `1 x 0`: **1 ponto**.
- Resultado real `1 x 1`, palpite `0 x 0`: **1 ponto**.
- Resultado real `1 x 1`, palpite `2 x 1`: **0 pontos**.

## Login

- Cada participante entra com conta Google.
- Depois do Google, a senha do grupo confirma o acesso a liga.
- O usuario real vem do Supabase Auth, usando `auth.uid()`.
- O e-mail Google fica salvo no perfil para exibicao no ranking e na lista de participantes.

## Seguranca

- RLS fica ativo desde o inicio.
- Cada palpite pertence ao `user_id` autenticado.
- O usuario so pode criar, editar ou remover os proprios palpites.
- O responsavel pela organizacao cadastra partidas, resultados e premios diretamente no Supabase.
- O banco recalcula pontos quando uma partida e finalizada.

## Liga

- Cada bolao e uma liga.
- A liga tem responsavel, participantes e codigo de convite.
- Um participante so ve partidas, ranking e premios das ligas em que participa.
- Nesta versao, a tela principal foca nos jogos do Brasil na Copa do Mundo de 2026.
