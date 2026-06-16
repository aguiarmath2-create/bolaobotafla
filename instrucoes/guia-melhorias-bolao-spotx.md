# Guia de Melhorias — Palpites Spotx

> Documento de referência para evoluir o `site/index.html` do Palpites Spotx.
> Deploy: SpotLab. Auth: `window.__SPOTLAB_CURRENT_USER_EMAIL__`. Banco: Supabase `oqsxxjivmbkrifggsgcd`.

---

## 1. Escopo de jogos

O app exibe **somente os jogos do Brasil** durante a Copa do Mundo 2026. Não há navegação por fase/grupo — apenas uma lista cronológica dos jogos do Brasil (no máximo 7: 3 grupos + 4 mata-mata).

**No Supabase:** os jogos já estão inseridos. Para filtrar apenas os do Brasil, a query deve usar:
```js
.or('home_team_id.eq.<id_brasil>,away_team_id.eq.<id_brasil>')
```
O `id` do Brasil deve ser lido dinamicamente da tabela `teams` pelo nome:
```js
const { data: brazil } = await db.from('teams').select('id').ilike('name', '%brasil%').single();
```

---

## 2. Paleta visual e estilo

Inspirada no Palpites Spotx. Trocar o indigo pelo **verde** como cor primária, fundo escuro como padrão.

| Elemento | Palpites Spotx | Palpites Spotx (atual) | Palpites Spotx (novo) |
|---|---|---|---|
| Cor primária | emerald-500 | indigo-600 | green-500 |
| Fundo body | `#111` dark-first | slate-100 light-first | `#111` dark-first |
| Cards | `bg-[#161616]` | `bg-white dark:bg-gray-900` | `bg-[#161616] dark:bg-[#161616]` |
| Badge AO VIVO | verde pulsante | — | verde pulsante |

**Tailwind config a adicionar no `<head>`:**
```html
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: { brand: '#22c55e' }
      }
    }
  }
</script>
```

**Iniciar já em dark mode** (remover dependência do localStorage para a abertura inicial):
```html
<script>document.documentElement.classList.add('dark');</script>
```

---

## 3. Card de partida

O card é o elemento mais importante do app. Estrutura nova:

```
┌─────────────────────────────────────────┐
│  [badge status]          [data/hora]    │
│                                         │
│  🇧🇷 Brasil    2 – 1    🇦🇷 Argentina  │
│                                         │
│  ┌──────────┐           ┌──────────┐   │
│  │ bandeira │           │ bandeira │   │
│  └──────────┘           └──────────┘   │
│                                         │
│  [palpite do usuário: 2-0 · 5 pts]     │
│  [botão Palpitar / Editar]             │
└─────────────────────────────────────────┘
```

### 3.1 Badge de status

| Status | Aparência |
|---|---|
| UPCOMING | `FECHADO` cinza — com contagem regressiva se < 24h |
| LIVE / IN_PLAY | `● AO VIVO 74'` verde pulsante |
| PAUSED | `INTERVALO` amarelo |
| FINISHED | `ENCERRADO` cinza escuro |

**Contagem regressiva** (substituir "FECHADO" quando falta menos de 24h):
```js
function countdownLabel(scheduledAt) {
  const diff = new Date(scheduledAt) - new Date();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return null; // mostra data normal
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
```

### 3.2 Placar

- **UPCOMING**: exibe `vs` em cinza
- **LIVE / FINISHED**: exibe `2 – 1` em branco/negrito
- **Palpite do usuário**: exibe abaixo do placar — `Seu palpite: 2-0 · 5 pts` (verde) ou `Sem palpite` (cinza)

### 3.3 Classe base do card

```html
<div class="rounded-2xl border border-white/10 bg-[#161616] p-5 hover:border-green-500/30 transition-all">
```

---

## 4. Placar em tempo real (ESPN)

O SpotLab não tem Vercel Functions, então o polling do ESPN é feito **direto no browser**.

**URL da ESPN (pública, sem auth):**
```
https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard
```

**Função de polling a adicionar no script:**
```js
const ESPN_STATUS_MAP = {
  STATUS_IN_PROGRESS: 'LIVE',
  STATUS_FIRST_HALF:  'LIVE',
  STATUS_SECOND_HALF: 'LIVE',
  STATUS_OVERTIME:    'LIVE',
  STATUS_HALFTIME:    'PAUSED',
  STATUS_END_PERIOD:  'PAUSED',
  STATUS_FINAL:       'FINISHED',
  STATUS_FULL_TIME:   'FINISHED',
  STATUS_FT:          'FINISHED',
};

async function pollESPN() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard');
    if (!res.ok) return;
    const { events = [] } = await res.json();

    let changed = false;
    for (const event of events) {
      const espnStatus = ESPN_STATUS_MAP[event.status?.type?.name];
      if (!espnStatus) continue;

      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      // Tenta casar com jogo do Brasil pelo timestamp (±1min)
      const espnTs = new Date(event.date).getTime();
      const match = brazilMatches.find(m =>
        Math.abs(new Date(m.scheduled_at).getTime() - espnTs) < 60000
      );
      if (!match) continue;

      const homeScore = parseInt(home.score);
      const awayScore = parseInt(away.score);
      const minute = parseInt((event.status?.displayClock || '').split(':')[0]) || null;

      if (match.status !== espnStatus || match.live_home !== homeScore || match.live_away !== awayScore) {
        match.status    = espnStatus;
        match.live_home = isNaN(homeScore) ? null : homeScore;
        match.live_away = isNaN(awayScore) ? null : awayScore;
        match.minute    = minute;
        changed = true;

        // Quando terminar, atualiza o Supabase para o trigger de pontos disparar
        if (espnStatus === 'FINISHED' && !isNaN(homeScore) && !isNaN(awayScore)) {
          supabasePatchFinished(match.id, homeScore, awayScore).catch(() => {});
        }
      }
    }
    if (changed) renderMatches();
  } catch (_) {}
}

async function supabasePatchFinished(matchId, homeScore, awayScore) {
  await db.from('matches')
    .update({ status: 'FINISHED', home_score: homeScore, away_score: awayScore })
    .eq('id', matchId).neq('status', 'FINISHED');
}

// Controle do poller
function isGameWindowActive() {
  return brazilMatches.some(m => {
    if (m.status === 'LIVE') return true;
    const diff = (new Date(m.scheduled_at) - new Date()) / 60000;
    return diff > -180 && diff < 30;
  });
}

function startPoller() {
  clearInterval(window._espnPoller);
  window._espnPoller = setInterval(() => {
    if (isGameWindowActive()) pollESPN();
  }, 30000);
  if (isGameWindowActive()) pollESPN(); // disparo imediato
}
```

---

## 5. Pontuação

Mantém a regra atual do SpotX. **Não é acumulativa.**

| Acerto | Pontos |
|---|---|
| Placar exato (ex: 2-1 = 2-1) | **5 pts** |
| Resultado correto sem placar exato (ex: vitória/empate) | **3 pts** |
| Errou | **0 pts** |

O cálculo no frontend:
```js
function calculatePoints(realHome, realAway, predHome, predAway) {
  if (realHome === predHome && realAway === predAway) return 5;
  if (Math.sign(realHome - realAway) === Math.sign(predHome - predAway)) return 3;
  return 0;
}
```

O Supabase deve ter o trigger `trg_recalculate_match_predictions` ativo para recalcular automaticamente quando `status = 'FINISHED'` for escrito.

---

## 6. Ranking

Sem filtro de departamento na tela principal — exibir ranking geral simples com:
- Posição (🥇🥈🥉 para top 3)
- Avatar com inicial
- Nome do colaborador
- Total de pontos
- Número de palpites

Coluna de departamento: opcional, oculta em mobile.

---

## 7. Layout geral

### Mobile-first (tela única, scroll vertical)

```
[Header: logo SpotX + nome do usuário]
[Banner: Brasil na Copa 2026]
[Lista de jogos do Brasil — cards empilhados]
[Ranking — tabela compacta]
```

### Desktop (duas colunas)

```
[Header fixo]
┌──────────────────────┬──────────────┐
│ Lista de jogos       │ Meu resumo   │
│ (flex-col, gap-4)    │ Ranking top5 │
│                      │ Premiação    │
└──────────────────────┴──────────────┘
```

---

## 8. Header simplificado

Remover nav de fases — não é necessário com escopo Brasil.

```html
<!-- Manter apenas -->
<header>
  [Logo SpotX]                [Nome usuário + avatar + menu dropdown]
</header>
```

Menu dropdown mantém: Ver meus palpites · Configurações · Admin (se admin).

---

## 9. Admin panel

Simplificar para apenas duas abas:
1. **Partidas** — listar jogos do Brasil, botão "Inserir resultado", botão "Bloquear palpites"
2. **Usuários** — lista de colaboradores com papel e palpites

Remover aba "Torneio" (fixo) e "Premiação" (configurar direto no Supabase se necessário).

---

## 10. O que NÃO mudar

- Autenticação via `window.__SPOTLAB_CURRENT_USER_EMAIL__`
- Supabase client e URL/key (já configurados)
- Lógica de upsert de palpites com `onConflict: 'user_email,match_id'`
- Triggers do banco (manter intocados)
- Palavra "aposta" banida — usar sempre "palpite"
- Deploy via SpotLab (substituir o `site/index.html`)

---

## 11. Ordem de implementação sugerida

1. **Filtrar jogos do Brasil** — query correta no `loadMatches()`
2. **Reescrever `renderMatchCard()`** — novo visual dark, badge de status, placar
3. **Adicionar `pollESPN()`** e `startPoller()` no script
4. **Ajustar header** — remover nav de fases, simplificar
5. **Ajustar ranking** — remover filtro departamento, melhorar visual
6. **Testar no SpotLab** — publicar e validar com e-mail real

---

*Última atualização: 2026-06-12 — Matheus Aguiar + Claude Sonnet 4.6*


