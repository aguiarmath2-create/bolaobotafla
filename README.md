# Palpites entre Amigos

App simples de bolao entre amigos usando Supabase Auth com Google Login.

## Stack

- Frontend: HTML + JavaScript + Tailwind CDN
- Auth: Supabase Auth com Google
- Banco: Supabase/PostgreSQL
- Seguranca: RLS usando `auth.uid()`

## Regra de pontuacao

- Placar exato: 3 pontos
- Resultado certo: 1 ponto
- Erro: 0 pontos

## Setup no Supabase

1. Criar um novo projeto Supabase.
2. Executar `banco-de-dados/schema-google-auth.sql` no SQL Editor.
3. Ativar Google em Authentication > Providers > Google.
4. Criar OAuth Client no Google Cloud.
5. Configurar no Google:
   - Authorized JavaScript origins: URL do site.
   - Authorized redirect URIs: callback informado pelo Supabase.
6. Configurar no Supabase:
   - Site URL: URL do site.
   - Redirect URLs: URL do site.
7. Colar a Project URL e a publishable key em `site/index.html`.


## Table Editor vazio no Supabase

Se o Table Editor mostrar "No tables or views", o schema ainda nao foi executado nesse projeto Supabase. Va em SQL Editor, cole e execute primeiro:

```txt
banco-de-dados/schema-google-auth.sql
```

Depois, se o banco ja existia antes das ultimas melhorias, execute tambem:

```txt
banco-de-dados/2026-06-10-profile-self-insert-policy.sql
banco-de-dados/2026-06-10-seed-league-matches-rpc.sql
```

As tabelas esperadas sao `profiles`, `leagues`, `league_members`, `teams`, `matches`, `predictions` e `prizes`.

## Senha do grupo

Depois do login Google, o site pede uma senha simples de entrada:

```txt
VJYbLY26@5X==KhQ4dQs=3tCzKt5
```

Essa senha funciona como uma barreira de conveniencia depois da autenticacao. A seguranca real continua sendo Supabase Auth + RLS + controle de membros da liga.

## Teste local do Google Login

Nao abra o HTML por `file://` para testar login Google. Use um servidor local ou uma URL publicada.

Exemplo:

```powershell
cd "C:\Users\aguia\Desktop\PALPITES SPOTX\site"
python -m http.server 8080
```

Depois acesse:

```txt
http://localhost:8080
```

No Supabase, configure em Authentication > URL Configuration:

- Authentication > Providers > Google: habilitado.
- Authentication > URL Configuration > Site URL: `http://localhost:8080`
- Authentication > URL Configuration > Redirect URLs: `http://localhost:8080`

## Google Provider

No Supabase > Authentication > Providers > Google:

- `Client IDs`: cole o Client ID criado no Google Cloud.
- `Client Secret`: cole o Client Secret do OAuth Client.
- `Skip nonce checks`: deixe desligado.
- `Allow users without an email`: deixe desligado.

No Google Cloud OAuth Client:

- Authorized JavaScript origins: `http://localhost:8080`
- Authorized redirect URIs: use a callback do Supabase, normalmente `https://hpfjosbwvgozxgplfcvk.supabase.co/auth/v1/callback`


## Deploy na Vercel

Este projeto tem `vercel.json` apontando a rota `/` para `site/index.html`.

Passo a passo:

1. Subir este projeto para um repositorio GitHub.
2. Na Vercel, clicar em Add New > Project.
3. Importar o repositorio.
4. Framework Preset: Other.
5. Build Command: deixar vazio.
6. Output Directory: deixar vazio.
7. Deploy.

Use o nome do projeto como:

```txt
palpites-spotx
```

Se estiver disponivel, a Vercel vai gerar:

```txt
https://palpites-spotx.vercel.app
```

Use essa URL em todos os lugares abaixo.

No Supabase > Authentication > URL Configuration:

- Site URL:
  ```txt
  https://palpites-spotx.vercel.app
  ```
- Redirect URLs:
  ```txt
  https://palpites-spotx.vercel.app
  ```

No Google Cloud OAuth Client:

- Authorized JavaScript origins:
  ```txt
  https://palpites-spotx.vercel.app
  ```
- Authorized redirect URIs:
  ```txt
  https://hpfjosbwvgozxgplfcvk.supabase.co/auth/v1/callback
  ```


Se `palpites-spotx` nao estiver disponivel, use o nome alternativo que a Vercel gerar e repita a configuracao com a URL final.


## Atualizacao dos jogos e interface

A tela principal agora carrega os jogos do Brasil, cards de palpites, tabela e ranking. Se voce ja executou o schema no Supabase antes desta atualizacao, rode tambem no SQL Editor:

```txt
banco-de-dados/2026-06-10-seed-league-matches-rpc.sql
```

Essa RPC semeia as partidas iniciais somente para ligas onde o usuario autenticado pode administrar a liga no banco.


## Fluxo atual no app

1. Usuario entra com Google.
2. Digita a senha do grupo.
3. Se ainda nao participa de nenhuma liga, pode criar uma liga ou entrar usando codigo de convite.
4. O criador da liga recebe o codigo para compartilhar com os amigos.
5. Os amigos entram pelo codigo e compartilham os mesmos jogos, ranking, tabela de jogos e status de quem ja palpitou.

Se o banco ja existia antes desta etapa, aplique tambem:

```txt
banco-de-dados/2026-06-10-profile-self-insert-policy.sql
banco-de-dados/2026-06-10-seed-league-matches-rpc.sql
```

## Fluxo de liga

- O usuario entra com Google.
- Ao criar uma liga, o banco adiciona o criador como `OWNER`.
- Para entrar em uma liga existente, o usuario usa `join_league_by_invite_code(codigo)`.
- O acesso a partidas, palpites e premios fica limitado aos membros da liga.
- A aba Tabela mostra todos os jogos e quem ja palpitou ou ainda falta, sem uma aba Admin no site.

## Arquivos

- `site/index.html`: tela inicial com login Google e senha do grupo.
- `banco-de-dados/schema-google-auth.sql`: schema novo com Auth/RLS.
- `instrucoes/regras-do-bolao-amigos.md`: regras da versao.

## Proximo passo

Depois que o Google Provider estiver configurado no Supabase, validar o login e evoluir as telas de rodadas, palpites e ranking.










## Arquivo legado desabilitado

Nao execute `banco-de-dados/2026-06-10-lock-time-2h.sql`. Ele foi mantido apenas como historico e esta bloqueado porque resemearia 72 jogos e apagaria palpites existentes. Para a versao atual, use a seed focada nos jogos do Brasil.
## Palpite de selecao campea

Antes do primeiro palpite em partidas, cada participante precisa escolher uma selecao campea. Em bancos ja existentes, execute tambem:

```txt
banco-de-dados/2026-06-12-champion-picks.sql
```

A tela principal agora usa todos os jogos carregados no Supabase; nao ha mais filtro limitado aos jogos do Brasil.
## Importacao completa de jogos

O app nao busca a tabela completa da Copa diretamente pelo SQL. O Supabase precisa receber os jogos via app/servidor e gravar pela RPC:

```txt
banco-de-dados/2026-06-12-import-copa-matches-rpc.sql
```

Para diagnosticar se o banco esta pronto, rode:

```txt
banco-de-dados/2026-06-12-supabase-healthcheck.sql
```

Se `matches_total` estiver baixo, por exemplo 7, o banco ainda esta com a seed antiga dos jogos do Brasil. A RPC nova importa ou atualiza partidas sem apagar palpites existentes.


