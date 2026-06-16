# Prompt para Claude — Palpites Spotx

> Cole este prompt inteiro no Claude dentro do projeto do Palpites Spotx.

---

## Contexto

Este projeto é uma cópia do **Palpites Spotx** (bolão de palpites da Copa do Mundo 2026) adaptada para uso interno da **SpotX**. O código original já está nesta pasta — a estrutura, lógica e features estão prontas e funcionando. Sua tarefa é adaptar para a SpotX conforme as instruções abaixo.

---

## O que é o projeto

Single Page Application em HTML puro com:
- **Frontend:** `site/index.html` — Tailwind CDN, Font Awesome, dark mode, mobile-first
- **Backend:** Supabase (PostgreSQL) — auth Google OAuth, tabelas `profiles`, `leagues`, `league_members`, `matches`, `predictions`, `teams`
- **Scores ao vivo:** `/api/live.js` — Vercel Serverless Function que consulta ESPN e faz patch no Supabase
- **Deploy:** Vercel (rewrite `/` → `site/index.html`, `/api/*` → funções serverless)
- **Auth:** Google OAuth via Supabase Auth + senha de grupo (hash SHA-256 no frontend)

---

## O que precisa mudar

### 1. Credenciais do Supabase (`site/index.html`)

Localizar e substituir:
```js
const SUPABASE_URL = 'https://hpfjosbwvgozxgplfcvk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hfhA_M2MV7wGlknhVat4Mw_Mb6bBniG';
```
Pelas credenciais do novo projeto Supabase da SpotX:
```js
const SUPABASE_URL = '[NOVA_URL_SUPABASE_SPOTX]';
const SUPABASE_PUBLISHABLE_KEY = '[NOVA_PUBLISHABLE_KEY_SPOTX]';
```

### 2. Senha do grupo (`site/index.html`)

Localizar:
```js
const ACCESS_CODE_SHA256 = '9d7098c74a9b89c5bb7a2a0167a9846f4bc20f75ab00aeb1c53b04ac398a92ac';
```
Gerar novo hash SHA-256 da nova senha do grupo SpotX e substituir. Para gerar o hash:
```js
// No browser console:
crypto.subtle.digest('SHA-256', new TextEncoder().encode('NOVA_SENHA'))
  .then(h => console.log(Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('')));
```

### 3. Branding (`site/index.html`)

Substituir todas as ocorrências de:
- `"Palpites Spotx"` → `"Palpites Spotx"`
- `"Palpites Spotx"` → `"BolÃ£o SpotX"` (versão com encoding)

A imagem do Palpites Spotx (`/images.jpg`) nas telas de login deve ser substituída pela logo ou imagem da SpotX. Se não houver imagem definida ainda, use um fundo gradiente escuro no lugar:
```html
<!-- Substituir o <img src="/images.jpg"> nas views de login/access por: -->
<div class="absolute inset-0 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 flex items-center justify-center">
  <div class="text-center">
    <p class="text-6xl font-black text-emerald-400">SpotX</p>
    <p class="text-slate-500 mt-2 font-bold uppercase tracking-widest text-sm">Copa do Mundo 2026</p>
  </div>
</div>
```

### 4. Regras de pontuação (a confirmar com o usuário)

**Opção A — manter igual ao Palpites Spotx (3/1/0):**
Nenhuma mudança necessária.

**Opção B — regra SpotX (5/3/0):**
Localizar a função `calculatePoints` (ou `calcLivePoints`) e ajustar:
```js
// Atual (3/1/0):
function calcLivePoints(pred, hs, as_) {
  if (pred.home_score === hs && pred.away_score === as_) return 3;
  const pr = ...; const lr = ...;
  return pr === lr ? 1 : 0;
}

// Novo (5/3/0):
function calcLivePoints(pred, hs, as_) {
  if (pred.home_score === hs && pred.away_score === as_) return 5;
  const pr = ...; const lr = ...;
  return pr === lr ? 3 : 0;
}
```
Também atualizar a view de Regras no HTML para refletir os novos valores (5 pts / 3 pts / 0 pts).

### 5. Credencial do Supabase na Vercel Function (`api/live.js`)

O arquivo `api/live.js` usa `process.env.SUPABASE_SERVICE_ROLE_KEY`. Esta variável de ambiente precisa ser configurada no painel da Vercel do novo projeto SpotX com a **Service Role Key** do novo Supabase (nunca no código).

---

## O que NÃO muda

- Todos os jogos da Copa (não só Brasil) — manter a lógica atual de rounds/phases
- Estrutura de auth: Google OAuth + senha de grupo
- Lógica de live scores via ESPN (`/api/live.js`)
- Schema do banco (tabelas, triggers, RPCs) — ver instruções SQL abaixo
- Deploy via Vercel
- Visual dark mode, cards de partida, ranking, regras, membros

---

## SQL a executar no novo Supabase

Execute os arquivos abaixo no **SQL Editor** do novo projeto Supabase, **nesta ordem**:

1. `banco-de-dados/schema-google-auth.sql` — schema principal (tabelas, RLS, triggers)
2. `banco-de-dados/2026-06-10-auto-join-default-league.sql` — RPC para auto-join na liga padrão
3. `banco-de-dados/2026-06-10-seed-league-matches-rpc.sql` — RPC para seed dos jogos
4. `banco-de-dados/2026-06-10-predictions-security-fixes.sql` — correções de segurança nas predictions
5. `banco-de-dados/2026-06-10-profile-self-insert-policy.sql` — policy para criação de perfil
6. `banco-de-dados/2026-06-10-lock-time-2h.sql` — regra de fechamento 1h antes do jogo
7. `banco-de-dados/2026-06-10-round-lock.sql` — travamento de rodadas em sequência

Após executar o schema, o primeiro usuário a logar precisa ter o role `OWNER` na liga padrão. Isso acontece automaticamente pelo RPC `auto_join_default_league` na primeira entrada.

---

## Configuração do Google OAuth no novo Supabase

No painel do Supabase do projeto SpotX:
1. Authentication → Providers → Google → Enable
2. Adicionar Client ID e Client Secret do Google Cloud Console
3. Em **Redirect URLs**, adicionar o domínio Vercel do projeto SpotX:
   - `https://[novo-dominio-vercel].vercel.app/**`
   - `http://localhost:5500/**` (para desenvolvimento local)

---

## Variáveis de ambiente na Vercel

No painel da Vercel do projeto SpotX, configurar:
- `SUPABASE_SERVICE_ROLE_KEY` = Service Role Key do novo Supabase SpotX

---

## Checklist final

- [ ] `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` atualizados em `site/index.html`
- [ ] `ACCESS_CODE_SHA256` atualizado com hash da nova senha
- [ ] Branding "Palpites Spotx" → "Palpites Spotx" substituído
- [ ] Imagem do Palpites Spotx substituída (ou removida)
- [ ] Regras de pontuação definidas (3/1/0 ou 5/3/0)
- [ ] SQL executado no novo Supabase (na ordem listada)
- [ ] Google OAuth configurado no novo Supabase
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configurada na Vercel
- [ ] Deploy realizado e testado

---

*Gerado em 2026-06-12 para migração Palpites Spotx → Palpites Spotx*


