-- Fix: remove jogo duplicado Brasil vs Haiti.
--
-- Causa: seed_league_matches criou o jogo às 22:00 BRT (01:00 UTC); o
-- import_copa_matches (football-data.org) criou um segundo registro às
-- 21:30 BRT (00:30 UTC). A diferença de exatamente 30 min falhou no teste
-- "abs(...) < 1800" do fallback de deduplicação, gerando entrada duplicada.
--
-- Correção: mantém o registro de 21:30 BRT (horário oficial football-data.org),
-- migra palpites do seed (22:00 BRT) para ele e apaga o duplicado.
--
-- Execute no SQL Editor do Supabase. Pode ser reexecutado com segurança.

-- ─── 1. Diagnóstico antes ─────────────────────────────────────────────────────
select
  m.id,
  m.match_number,
  to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as horario_brasilia,
  m.status,
  (select count(*) from public.predictions p where p.match_id = m.id) as total_palpites
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
where lower(ht.name) = 'brasil' and lower(at.name) = 'haiti'
order by m.scheduled_at;

-- ─── 2. Remove duplicados ─────────────────────────────────────────────────────
-- Mantém o id=37 (match_number=537341, 21:30 BRT, mais palpites).
-- Apaga id=98 (mesma API, duplicata) e id=78 (seed, horário errado).
do $$
declare
  v_keep_id bigint;
  v_drop_ids bigint[];
  v_drop_id bigint;
  v_total_migrated integer := 0;
  v_migrated integer;
begin
  -- Jogo correto: maior número de palpites entre todos os Brasil vs Haiti.
  -- Em caso de empate, prefere o match_number maior (ID oficial da API).
  select m.id into v_keep_id
  from public.matches m
  join public.teams ht on ht.id = m.home_team_id
  join public.teams at on at.id = m.away_team_id
  where lower(ht.name) = 'brasil' and lower(at.name) = 'haiti'
  order by
    (select count(*) from public.predictions p where p.match_id = m.id) desc,
    m.match_number desc
  limit 1;

  if v_keep_id is null then
    raise notice 'Brasil vs Haiti não encontrado — nada a fazer.';
    return;
  end if;

  -- Todos os outros registros Brasil vs Haiti que serão removidos.
  select array_agg(m.id) into v_drop_ids
  from public.matches m
  join public.teams ht on ht.id = m.home_team_id
  join public.teams at on at.id = m.away_team_id
  where lower(ht.name) = 'brasil' and lower(at.name) = 'haiti'
    and m.id <> v_keep_id;

  if v_drop_ids is null or array_length(v_drop_ids, 1) = 0 then
    raise notice 'Apenas um Brasil vs Haiti no banco (id=%) — nenhum duplicado.', v_keep_id;
    return;
  end if;

  raise notice 'Mantendo id=% | Removendo ids=%', v_keep_id, v_drop_ids;

  -- Para cada duplicado: migra palpites e apaga.
  foreach v_drop_id in array v_drop_ids loop
    -- Migra palpites cujo usuário ainda não tem palpite no jogo correto.
    update public.predictions
    set match_id = v_keep_id
    where match_id = v_drop_id
      and user_id not in (
        select user_id from public.predictions where match_id = v_keep_id
      );

    get diagnostics v_migrated = row_count;
    v_total_migrated := v_total_migrated + v_migrated;
    raise notice '  id=%: % palpites migrados', v_drop_id, v_migrated;

    -- Apaga palpites restantes (usuário já tinha no jogo correto).
    delete from public.predictions where match_id = v_drop_id;

    -- Apaga o jogo duplicado.
    delete from public.matches where id = v_drop_id;
  end loop;

  raise notice 'Concluído. Total de palpites migrados: %', v_total_migrated;
end;
$$;

-- ─── 3. Confirmação ───────────────────────────────────────────────────────────
select
  m.id,
  m.match_number,
  ht.name as mandante,
  at.name as visitante,
  to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as horario_brasilia,
  m.status,
  (select count(*) from public.predictions p where p.match_id = m.id) as total_palpites
from public.matches m
join public.teams ht on ht.id = m.home_team_id
join public.teams at on at.id = m.away_team_id
where lower(ht.name) = 'brasil' and lower(at.name) = 'haiti'
order by m.scheduled_at;
