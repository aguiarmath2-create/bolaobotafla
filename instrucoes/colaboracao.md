# Colaboracao - Palpites entre Amigos

Este arquivo registra decisoes, execucoes e handoffs da nova versao do bolao para amigos.

## Formato

```
### [AUTOR/AGENTE] - [DATA E HORA] - [ASSUNTO]

STATUS: [PLANEJADO / EM ANDAMENTO / CONCLUIDO / BLOQUEADO]
TAREFA: <descricao objetiva>
AUTOR: <quem executou ou decidiu>
DETALHES: <contexto e decisoes>
HANDOFF: <proxima pessoa/agente e acao>
```

---

### Codex - 2026-06-10 09:40 - Limpeza da Base Anterior e Consolidacao da Versao Amigos

STATUS: CONCLUIDO
TAREFA: Remover legado do projeto anterior e deixar somente a base do bolao entre amigos
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: Removidas as pastas antigas `agents`, `banco-de-dados`, `instrucoes`, `Logo` e `site` relacionadas ao projeto anterior. A estrutura nova foi promovida para a raiz do projeto. A base atual contem apenas `site/index.html`, `banco-de-dados/schema-google-auth.sql`, `instrucoes/regras-do-bolao-amigos.md`, `instrucoes/colaboracao.md` e `README.md`. O README foi limpo para remover referencias ao projeto anterior.
HANDOFF: Mattheus Aguiar - configurar Google Provider no Supabase e executar o schema `banco-de-dados/schema-google-auth.sql` no novo projeto.

---

### Codex - 2026-06-10 09:38 - Login Google com Senha do Grupo

STATUS: CONCLUIDO
TAREFA: Melhorar tela de login e adicionar senha de entrada antes do Google Auth
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: `site/index.html` atualizado com campo de senha do grupo antes do botao de login Google, hash SHA-256 no frontend, desbloqueio via `sessionStorage`, icone oficial colorido do Google no botao e mensagem clara quando o OAuth e iniciado por `file://`. `README.md` atualizado com a senha do grupo, orientacao para testar via `http://localhost:8080` e checklist de configuracao do Google Provider no Supabase/Google Cloud.
HANDOFF: Mattheus Aguiar - habilitar Google Provider no Supabase e configurar URLs de redirect/origin antes de testar o login novamente.

---

### Codex - 2026-06-10 09:48 - Login Microsoft/Outlook

STATUS: CONCLUIDO
TAREFA: Adicionar Microsoft/Azure como segunda opcao de login
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: `site/index.html` atualizado para exibir botoes de login Google e Microsoft apos a senha do grupo. O login Microsoft usa `supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email' } })`. `README.md` atualizado com campos de configuracao do provider Google e do provider Azure, incluindo Callback URL, Application Client ID, Secret Value e Tenant URL recomendado para contas Outlook/Hotmail.
HANDOFF: Mattheus Aguiar - criar OAuth Client no Google Cloud e App Registration no Microsoft Entra ID, depois preencher os providers no Supabase.

---

### Codex - 2026-06-10 09:47 - Configuracao para Deploy na Vercel

STATUS: CONCLUIDO
TAREFA: Preparar o projeto para publicacao na Vercel e documentar URLs de OAuth
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: Criado `vercel.json` com rewrite de `/` para `site/index.html`, permitindo publicar o projeto pela Vercel sem mover o arquivo principal. `README.md` atualizado com passo a passo de deploy na Vercel e com as URLs que devem ser cadastradas no Supabase, Google Cloud OAuth Client e Microsoft Entra ID/Azure App Registration. Validacao executada: `vercel.json` parseado com sucesso e scripts inline do HTML com sintaxe OK.
HANDOFF: Mattheus Aguiar - publicar na Vercel, copiar a URL final e substituir `https://nome-do-projeto.vercel.app` nas configuracoes de Supabase/Google Cloud.

---

### Codex - 2026-06-10 10:05 - Tela de Login com Palpites Spotx e Senha Pos-Auth

STATUS: CONCLUIDO
TAREFA: Reordenar fluxo de acesso e aplicar identidade visual do Palpites Spotx
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: `site/index.html` atualizado para exibir a tela inicial com a imagem `images.jpg`, titulo `Palpites Spotx - Copa do Mundo 2026` e botoes Google/Microsoft antes da senha. A senha do grupo agora aparece somente depois que o usuario autentica com Google ou Microsoft. A area inicial do bolao so e exibida apos login e senha corretos. `README.md` atualizado para refletir que a senha e solicitada depois da autenticacao.
HANDOFF: Mattheus Aguiar - configurar os providers Google/Microsoft no Supabase e testar o fluxo publicado/local.

---
### Codex - 2026-06-10 10:20 - Remocao do Login Microsoft

STATUS: CONCLUIDO
TAREFA: Remover login Microsoft/Azure e manter apenas Google
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: site/index.html atualizado para mostrar somente o botao Entrar com Google e remover a chamada OAuth do provider Azure. README.md revisado para orientar apenas configuracao do Google Provider no Supabase e Google Cloud.
HANDOFF: Mattheus Aguiar - configurar apenas o Google Provider no Supabase e usar a callback https://hpfjosbwvgozxgplfcvk.supabase.co/auth/v1/callback no Google Cloud.

---
### Codex - 2026-06-10 10:34 - Reconstrucao da Interface de Palpites

STATUS: CONCLUIDO
TAREFA: Restaurar experiencia de jogos, palpites e ranking na versao Palpites Spotx
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: site/index.html deixou de ser uma tela minima e passou a ter layout com sidebar, hero do bolao, fases/rodadas, cards de partidas, envio/atualizacao de palpites, progresso do usuario, ranking ao vivo e regras. O app cria uma liga inicial para o usuario autenticado e chama uma RPC segura para semear partidas quando a liga esta vazia.
HANDOFF: Mattheus Aguiar - aplicar no Supabase o SQL anco-de-dados/2026-06-10-seed-league-matches-rpc.sql caso o schema ja tenha sido criado antes desta atualizacao.

---
### Codex - 2026-06-10 10:42 - Port da Logica SpotX para Amigos

STATUS: CONCLUIDO
TAREFA: Aproveitar estrutura da pasta SpotX no Palpites Spotx
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: A interface passou a reaproveitar o modelo de experiencia da SpotX com navegacao lateral/mobile, tela de liga por codigo, criacao de liga, entrada por convite, perfil/resumo, ranking ao vivo, cards de palpites por rodada e painel admin para salvar resultados. Mantido o schema novo com Google Auth, leagues e RLS. Adicionada politica segura profiles_self_insert para o usuario autenticado garantir o proprio profile.
HANDOFF: Mattheus Aguiar - se o banco ja foi criado, aplicar tambem anco-de-dados/2026-06-10-profile-self-insert-policy.sql no Supabase.

---
### Codex - 2026-06-10 10:45 - Tabela Publica de Jogos e Remocao de Admin

STATUS: CONCLUIDO
TAREFA: Remover aba Admin e permitir que todos vejam quem ja palpitou
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: site/index.html atualizado para remover a navegacao e tela Admin. Adicionada aba Tabela com todos os jogos, status, contagem de palpites e listas de quem ja palpitou e quem ainda falta, sem expor placares individuais dos amigos. Ranking e cards de palpites permanecem disponiveis.
HANDOFF: Mattheus Aguiar - testar no app publicado com dois usuarios na mesma liga para validar a visualizacao de quem palpitou.

---
### Codex - 2026-06-10 10:52 - Correcao da Ordem Google Depois Senha

STATUS: CONCLUIDO
TAREFA: Garantir que a senha apareca somente apos o passo Google e explicar Table Editor vazio
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: site/index.html ajustado para sempre iniciar pelo passo Entrar/continuar com Google quando a confirmacao do Google nao ocorreu na sessao do app. A senha do grupo agora fica visualmente identificada com a foto do Palpites Spotx e o titulo Palpites Spotx - Copa do Mundo de 2026. Adicionada mensagem amigavel quando o banco ainda nao tem schema/tabelas.
HANDOFF: Mattheus Aguiar - executar anco-de-dados/schema-google-auth.sql no SQL Editor do Supabase para criar as tabelas caso o Table Editor esteja vazio.

---

### Codex - 2026-06-12 15:02 - Guia SpotX Adaptado ao Palpites Spotx

STATUS: CONCLUIDO
TAREFA: Aplicar melhorias do guia com visual mais sobrio, foco nos jogos do Brasil e regra 3/1/0
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: site/index.html ajustado para manter Google antes da senha, linguagem de palpite, tabela focada nos jogos do Brasil e pontuacao 3 pontos para placar exato, 1 ponto para resultado e 0 para erro. A RPC de seed e o schema principal agora criam somente os jogos do Brasil, com fase de grupos alinhada ao Grupo C de 2026 (13, 19 e 24 de junho) e placeholders bloqueados para possiveis fases eliminatorias. README e regras foram atualizados com orientacao para schema vazio no Supabase. A migration legada de 72 jogos foi bloqueada para evitar reseed acidental e perda de palpites.
HANDOFF: Mattheus Aguiar - executar o schema no Supabase novo caso o Table Editor ainda esteja vazio, depois testar login, senha, criacao automatica da liga e envio de palpite.

---
### Codex - 2026-06-12 17:54 - Todos os Jogos e Palpite de Campeao

STATUS: CONCLUIDO
TAREFA: Remover filtro de jogos do Brasil e exigir escolha de selecao campea no primeiro acesso
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: site/index.html voltou a organizar todos os jogos carregados por rodada/fase. A tabela tambem usa todos os jogos. Criada etapa obrigatoria de selecao campea com busca e lista selecionavel antes dos palpites. Adicionada tabela champion_predictions no schema e migration especifica para bancos ja existentes.
HANDOFF: Mattheus Aguiar - aplicar banco-de-dados/2026-06-12-champion-picks.sql no Supabase existente e garantir que a importacao de todos os jogos rode antes dos testes.

---
---
### Codex - 2026-06-12 18:05 - Diagnostico de Importacao Completa da Copa

STATUS: CONCLUIDO
TAREFA: Investigar por que todas as partidas oficiais nao carregam no site
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: Identificado que o app chamava apenas `seed_league_matches`, uma seed focada nos jogos do Brasil, e que `api/live.js` sincroniza somente jogos ao vivo/finalizados, sem cadastrar a tabela completa da Copa. Criado `banco-de-dados/2026-06-12-import-copa-matches-rpc.sql` para importar/atualizar partidas de forma idempotente, sem apagar palpites. Criado `banco-de-dados/2026-06-12-supabase-healthcheck.sql` para verificar contagem de jogos, times, palpites e existencia da RPC no Supabase.
HANDOFF: Mattheus Aguiar - executar a RPC nova no SQL Editor, rodar o healthcheck e depois conectar uma rotina do app/servidor para enviar o JSON completo dos jogos para `import_copa_matches`.

---
### Codex - 2026-06-13 00:00 - Logo e Bandeiras nos Cards

STATUS: CONCLUIDO
TAREFA: Exibir logo local no cabeçalho/banner e bandeiras acima dos nomes das seleções
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: `site/index.html` atualizado para usar `images.jpg` no banner principal e aplicar fallback de bandeiras por nome da seleção quando `teams.flag_url` vier vazio do Supabase. Cards de partidas, tabela/classificação e componentes auxiliares passam a usar `teamFlagUrl()` para manter bandeiras visíveis mesmo sem URL salva no banco.
HANDOFF: Mattheus Aguiar - atualizar/publicar o site e recarregar a página para validar as bandeiras nos cards.


---
### Codex - 2026-06-12 23:00 - Branding Palpites Spotx, Fluxo Campeao e Review de Seguranca

STATUS: CONCLUIDO
TAREFA: Revisar o codigo, trocar referencias de marca para Palpites Spotx e exigir escolha de campeao antes dos palpites
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: Referencias legadas a Palpites Spotx antigo foram normalizadas para `Palpites Spotx`; URLs/documentacao passaram a usar `palpites-spotx`. `site/index.html` agora mantem o conteudo principal oculto ate o usuario salvar sua selecao campea, e `switchView` bloqueia navegacao interna enquanto nao houver `champion_predictions`. Criada migration `banco-de-dados/2026-06-13-require-champion-before-predictions.sql` e schema principal atualizado para exigir selecao campea tambem no banco antes de aceitar palpites. `scripts/sync-matches.js` ajustado para persistir apenas jogos finalizados, evitando status `LIVE` fora do check constraint atual.
HANDOFF: Mattheus Aguiar - executar `banco-de-dados/2026-06-13-require-champion-before-predictions.sql` no Supabase existente e publicar os arquivos atualizados.

---
### Codex - 2026-06-12 23:12 - Campeao Definitivo e Visivel na Tabela

STATUS: CONCLUIDO
TAREFA: Garantir que a escolha de campeao apareca uma unica vez, fique registrada e seja exibida na Tabela
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: `site/index.html` atualizado para exibir a selecao campea salva na aba Tabela com selo `Definitivo`. A migration `2026-06-13-lock-champion-after-first-prediction.sql` foi ajustada para bloquear qualquer update/delete em `champion_predictions` apos o registro ser criado, e o schema principal recebeu a mesma regra. Validacao executada com `node --check` nos scripts e no JS inline do HTML.
HANDOFF: Mattheus Aguiar - rodar `banco-de-dados/2026-06-13-lock-champion-after-first-prediction.sql` no Supabase existente e publicar o HTML atualizado.

---
### Codex - 2026-06-13 00:18 - Migration Campeao Autossuficiente

STATUS: CONCLUIDO
TAREFA: Corrigir erro `relation public.champion_predictions does not exist` ao aplicar bloqueio da selecao campea
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: O erro ocorreu porque o bloqueio foi executado antes da criacao da tabela `champion_predictions`. Atualizados `2026-06-12-champion-picks.sql` e `2026-06-13-lock-champion-after-first-prediction.sql` para criarem a tabela, indice, RLS, policies e trigger definitivo de bloqueio. Agora o arquivo de bloqueio pode ser executado mesmo se a tabela ainda nao existir.
HANDOFF: Mattheus Aguiar - rodar novamente `banco-de-dados/2026-06-13-lock-champion-after-first-prediction.sql` no SQL Editor do Supabase.

---
### Codex - 2026-06-13 00:32 - Status nos Cards de Data e Assets Spotx

STATUS: CONCLUIDO
TAREFA: Sinalizar nos cards de data se o usuario ja palpitou e organizar logo/bandeiras
AUTOR: Codex (agente IA) - execucao; Mattheus Aguiar - solicitacao
DETALHES: `site/index.html` atualizado para mostrar `Feito`, `Pendente` ou contagem parcial `x/y` nos cards de data, com tooltip de progresso por dia. Criada pasta `site/logo` com `spotx-logo.svg` e o app passou a usar essa logo nas telas iniciais, sidebar, mobile header e banner principal. Criada pasta `site/bandeiras` com manifesto dos fallbacks de bandeiras via `TEAM_FLAG_CODES`/FlagCDN. Validacao executada com `node --check` nos scripts e no JS inline do HTML.
HANDOFF: Mattheus Aguiar - publicar o `site/index.html` atualizado junto com as novas pastas `site/logo` e `site/bandeiras`.
