# Prompt para Claude — Edge Function de Live Scores (SpotX)

> Cole este prompt no Claude dentro do projeto Palpites Spotx.
> Este documento trata exclusivamente da integração de placar em tempo real via Supabase Edge Function.

---

## Contexto

O Palpites Spotx é hospedado no SpotLab, que serve apenas arquivos HTML estáticos — não há Vercel nem serverless functions disponíveis.

Para buscar placares ao vivo da ESPN e atualizar o Supabase quando uma partida termina, usamos uma **Supabase Edge Function** (runtime Deno) dentro do próprio projeto Supabase da SpotX.

A Edge Function substitui o arquivo `api/live.js` que existe no Palpites Spotx (Vercel).

---

## O que a Edge Function precisa fazer

1. Receber uma requisição GET do frontend
2. Buscar o scoreboard da ESPN (API pública, sem autenticação)
3. Mapear os status da ESPN para os status internos (`IN_PLAY`, `PAUSED`, `FINISHED`)
4. Retornar os dados de placar ao vivo para o frontend
5. Quando ESPN reportar `FINISHED`: fazer PATCH no Supabase para atualizar o placar e status da partida — isso dispara automaticamente o trigger `trg_recalculate_match_predictions` que recalcula os pontos de todos os palpites

---

## Criar a Edge Function

### Passo 1 — Estrutura de pastas

Criar o arquivo:
```
supabase/functions/live/index.ts
```

### Passo 2 — Código da Edge Function

```typescript
// supabase/functions/live/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ESPN_STATUS_MAP: Record<string, string> = {
  STATUS_IN_PROGRESS: 'IN_PLAY',
  STATUS_FIRST_HALF:  'IN_PLAY',
  STATUS_SECOND_HALF: 'IN_PLAY',
  STATUS_OVERTIME:    'IN_PLAY',
  STATUS_HALFTIME:    'PAUSED',
  STATUS_END_PERIOD:  'PAUSED',
  STATUS_FINAL:       'FINISHED',
  STATUS_FULL_TIME:   'FINISHED',
  STATUS_FT:          'FINISHED',
};

const SYNC_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'FINISHED']);

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const espnRes = await fetch(ESPN_URL);
    if (!espnRes.ok) {
      return new Response(
        JSON.stringify({ error: `ESPN error: ${espnRes.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await espnRes.json();
    const events: any[] = data.events || [];

    // ?debug=1 retorna dados brutos da ESPN para diagnóstico
    const url = new URL(req.url);
    if (url.searchParams.get('debug') === '1') {
      return new Response(JSON.stringify({
        total: events.length,
        events: events.map((e: any) => ({
          date:   e.date,
          name:   e.name,
          status: e.status?.type?.name,
          clock:  e.status?.displayClock,
          period: e.status?.period,
          scores: e.competitions?.[0]?.competitors?.map((c: any) => ({
            team:  c.team?.displayName,
            score: c.score,
            home:  c.homeAway,
          })),
        })),
      }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const result = [];

    for (const event of events) {
      const statusName = event.status?.type?.name;
      const status = ESPN_STATUS_MAP[statusName];
      if (!status || !SYNC_STATUSES.has(status)) continue;

      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;

      const clockStr = event.status?.displayClock || '';
      const minute   = parseInt(clockStr.split(':')[0]) || null;
      const homeScore = parseInt(home.score);
      const awayScore = parseInt(away.score);

      result.push({
        utcDate:   event.date,
        status,
        minute,
        period:    event.status?.period ?? null,
        homeScore: isNaN(homeScore) ? null : homeScore,
        awayScore: isNaN(awayScore) ? null : awayScore,
        homeTeam:  home.team?.displayName,
        awayTeam:  away.team?.displayName,
      });

      // Quando ESPN confirmar FINISHED, patchar o Supabase
      // O trigger trg_recalculate_match_predictions recalcula pontos automaticamente
      if (status === 'FINISHED' && !isNaN(homeScore) && !isNaN(awayScore)) {
        const utcDate = new Date(event.date).toISOString();
        supabasePatch(utcDate, homeScore, awayScore).catch((e: Error) =>
          console.error('[live] supabase patch failed:', e.message)
        );
      }
    }

    console.log(`[live/espn] ${new Date().toISOString()} — ${result.length} partidas ativas`);

    return new Response(
      JSON.stringify({ matches: result }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function supabasePatch(utcDate: string, homeScore: number, awayScore: number) {
  const url = `${SUPA_URL}/rest/v1/matches?scheduled_at=eq.${encodeURIComponent(utcDate)}&status=neq.FINISHED`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({ status: 'FINISHED', home_score: homeScore, away_score: awayScore }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  console.log(`[live] patched: ${utcDate} FINISHED ${homeScore}-${awayScore}`);
}
```

---

## Variáveis de ambiente da Edge Function

No painel do Supabase → **Edge Functions → Secrets**, adicionar:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase SpotX (ex: `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key do projeto Supabase SpotX |

> As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` também podem já estar disponíveis por padrão no ambiente Deno do Supabase — verificar na documentação da versão atual.

---

## Deploy da Edge Function

```bash
# Instalar Supabase CLI se necessário
npm install -g supabase

# Login
supabase login

# Vincular ao projeto SpotX
supabase link --project-ref [PROJECT_REF_SPOTX]

# Deploy
supabase functions deploy live
```

Ou pelo painel do Supabase em **Edge Functions → New Function**.

---

## Ajuste no frontend (`site/index.html`)

### Localizar a função `pollLiveScores()`

Ela atualmente chama `/api/live` (rota Vercel). Substituir pela URL da Edge Function:

```js
// Atual (Vercel — NÃO usar no SpotX):
const res = await fetch('/api/live');

// Novo (Supabase Edge Function):
const res = await fetch(
  `${SUPABASE_URL}/functions/v1/live`,
  { headers: { Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` } }
);
```

As variáveis `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` já estão declaradas no topo do script do `site/index.html` — basta referenciar.

### Localizar `isMatchWindowActive()` e `startLivePoller()`

Nenhuma mudança necessária — a lógica de polling de 30s e a janela de ativação por horário continuam iguais.

---

## Como testar

### 1. Verificar se a Edge Function está respondendo

```
GET https://[PROJECT_REF].supabase.co/functions/v1/live?debug=1
Headers: Authorization: Bearer [PUBLISHABLE_KEY]
```

Deve retornar JSON com os eventos da ESPN.

### 2. Verificar durante uma partida ao vivo

```
GET https://[PROJECT_REF].supabase.co/functions/v1/live
Headers: Authorization: Bearer [PUBLISHABLE_KEY]
```

Deve retornar `{ matches: [...] }` com as partidas em andamento.

### 3. Verificar se o patch no Supabase ocorreu

Após uma partida terminar, verificar na tabela `matches` do Supabase se `status = 'FINISHED'` e os placares foram gravados.

---

## Por que não usar football-data.org no SpotX

A API football-data.org (free tier) mantém o status `TIMED` durante as partidas — nunca atualiza para `IN_PLAY`. Ela só é útil para registrar resultados após o jogo terminar.

A ESPN (`site.api.espn.com`) retorna status em tempo real (`STATUS_SECOND_HALF`, `STATUS_FIRST_HALF`, etc.) sem autenticação, por isso é a fonte primária de dados ao vivo.

O GitHub Actions com `scripts/sync-matches.js` (football-data.org) era um mecanismo de fallback do Palpites Spotx para garantir que os resultados fossem gravados mesmo se o polling live falhasse. No SpotX, a Edge Function cobre esse papel: assim que ESPN reporta `FINISHED`, o patch ocorre imediatamente.

---

*Gerado em 2026-06-12 — arquitetura SpotX: SpotLab + Supabase Edge Functions*


