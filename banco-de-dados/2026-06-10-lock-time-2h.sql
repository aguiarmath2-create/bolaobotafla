-- MIGRATION LEGADA DESABILITADA.
-- Nao execute este arquivo na versao atual do Palpites Spotx.
-- Ele resemearia 72 jogos e apagaria palpites existentes.
-- Use `schema-google-auth.sql` em projetos novos ou `2026-06-10-seed-league-matches-rpc.sql` para a seed focada nos jogos do Brasil.

do $$
begin
  raise exception 'Migration legada desabilitada. Use schema-google-auth.sql ou 2026-06-10-seed-league-matches-rpc.sql.';
end;
$$;
-- Palpites Spotx - Lock time 2h + calendÃ¡rio FIFA 2026 completo (72 jogos).
-- Execute no SQL Editor do Supabase. Atualiza partidas existentes e resemeia a liga.

-- 1. Atualiza partidas jÃ¡ existentes para 1h antes do inicio
update public.matches
set prediction_closes_at = scheduled_at - interval '1 hour'
where prediction_closes_at is not null;

-- 2. FunÃ§Ã£o seed com os 72 jogos oficiais da fase de grupos (horÃ¡rio de BrasÃ­lia, UTC-3)
create or replace function public.seed_league_matches(p_league_id uuid)
returns void as $$
declare
  v_existing integer;
  v_home_id bigint;
  v_away_id bigint;
  v_match jsonb;
  v_idx integer := 0;
  v_matches jsonb := '[
    {"h":"MÃ©xico","hf":"https://flagcdn.com/w80/mx.png","a":"Ãfrica do Sul","af":"https://flagcdn.com/w80/za.png","g":"A","dt":"2026-06-11T16:00:00-03:00","r":1},
    {"h":"Coreia do Sul","hf":"https://flagcdn.com/w80/kr.png","a":"Rep. Tcheca","af":"https://flagcdn.com/w80/cz.png","g":"A","dt":"2026-06-11T23:00:00-03:00","r":1},
    {"h":"Rep. Tcheca","hf":"https://flagcdn.com/w80/cz.png","a":"Ãfrica do Sul","af":"https://flagcdn.com/w80/za.png","g":"A","dt":"2026-06-18T13:00:00-03:00","r":2},
    {"h":"MÃ©xico","hf":"https://flagcdn.com/w80/mx.png","a":"Coreia do Sul","af":"https://flagcdn.com/w80/kr.png","g":"A","dt":"2026-06-19T00:00:00-03:00","r":2},
    {"h":"MÃ©xico","hf":"https://flagcdn.com/w80/mx.png","a":"Rep. Tcheca","af":"https://flagcdn.com/w80/cz.png","g":"A","dt":"2026-06-24T22:00:00-03:00","r":3},
    {"h":"Ãfrica do Sul","hf":"https://flagcdn.com/w80/za.png","a":"Coreia do Sul","af":"https://flagcdn.com/w80/kr.png","g":"A","dt":"2026-06-24T22:00:00-03:00","r":3},
    {"h":"CanadÃ¡","hf":"https://flagcdn.com/w80/ca.png","a":"BÃ³snia e Herzegovina","af":"https://flagcdn.com/w80/ba.png","g":"B","dt":"2026-06-12T16:00:00-03:00","r":1},
    {"h":"Catar","hf":"https://flagcdn.com/w80/qa.png","a":"SuÃ­Ã§a","af":"https://flagcdn.com/w80/ch.png","g":"B","dt":"2026-06-13T16:00:00-03:00","r":1},
    {"h":"SuÃ­Ã§a","hf":"https://flagcdn.com/w80/ch.png","a":"BÃ³snia e Herzegovina","af":"https://flagcdn.com/w80/ba.png","g":"B","dt":"2026-06-18T16:00:00-03:00","r":2},
    {"h":"CanadÃ¡","hf":"https://flagcdn.com/w80/ca.png","a":"Catar","af":"https://flagcdn.com/w80/qa.png","g":"B","dt":"2026-06-18T19:00:00-03:00","r":2},
    {"h":"BÃ³snia e Herzegovina","hf":"https://flagcdn.com/w80/ba.png","a":"Catar","af":"https://flagcdn.com/w80/qa.png","g":"B","dt":"2026-06-24T16:00:00-03:00","r":3},
    {"h":"SuÃ­Ã§a","hf":"https://flagcdn.com/w80/ch.png","a":"CanadÃ¡","af":"https://flagcdn.com/w80/ca.png","g":"B","dt":"2026-06-24T16:00:00-03:00","r":3},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","a":"Marrocos","af":"https://flagcdn.com/w80/ma.png","g":"C","dt":"2026-06-13T19:00:00-03:00","r":1},
    {"h":"Haiti","hf":"https://flagcdn.com/w80/ht.png","a":"EscÃ³cia","af":"https://flagcdn.com/w80/gb-sct.png","g":"C","dt":"2026-06-13T22:00:00-03:00","r":1},
    {"h":"EscÃ³cia","hf":"https://flagcdn.com/w80/gb-sct.png","a":"Marrocos","af":"https://flagcdn.com/w80/ma.png","g":"C","dt":"2026-06-19T19:00:00-03:00","r":2},
    {"h":"Brasil","hf":"https://flagcdn.com/w80/br.png","a":"Haiti","af":"https://flagcdn.com/w80/ht.png","g":"C","dt":"2026-06-19T22:00:00-03:00","r":2},
    {"h":"EscÃ³cia","hf":"https://flagcdn.com/w80/gb-sct.png","a":"Brasil","af":"https://flagcdn.com/w80/br.png","g":"C","dt":"2026-06-24T19:00:00-03:00","r":3},
    {"h":"Marrocos","hf":"https://flagcdn.com/w80/ma.png","a":"Haiti","af":"https://flagcdn.com/w80/ht.png","g":"C","dt":"2026-06-24T19:00:00-03:00","r":3},
    {"h":"Estados Unidos","hf":"https://flagcdn.com/w80/us.png","a":"Paraguai","af":"https://flagcdn.com/w80/py.png","g":"D","dt":"2026-06-12T22:00:00-03:00","r":1},
    {"h":"AustrÃ¡lia","hf":"https://flagcdn.com/w80/au.png","a":"Turquia","af":"https://flagcdn.com/w80/tr.png","g":"D","dt":"2026-06-14T01:00:00-03:00","r":1},
    {"h":"Estados Unidos","hf":"https://flagcdn.com/w80/us.png","a":"AustrÃ¡lia","af":"https://flagcdn.com/w80/au.png","g":"D","dt":"2026-06-19T16:00:00-03:00","r":2},
    {"h":"Turquia","hf":"https://flagcdn.com/w80/tr.png","a":"Paraguai","af":"https://flagcdn.com/w80/py.png","g":"D","dt":"2026-06-20T01:00:00-03:00","r":2},
    {"h":"Turquia","hf":"https://flagcdn.com/w80/tr.png","a":"Estados Unidos","af":"https://flagcdn.com/w80/us.png","g":"D","dt":"2026-06-25T23:00:00-03:00","r":3},
    {"h":"Paraguai","hf":"https://flagcdn.com/w80/py.png","a":"AustrÃ¡lia","af":"https://flagcdn.com/w80/au.png","g":"D","dt":"2026-06-25T23:00:00-03:00","r":3},
    {"h":"Alemanha","hf":"https://flagcdn.com/w80/de.png","a":"CuraÃ§ao","af":"https://flagcdn.com/w80/cw.png","g":"E","dt":"2026-06-14T14:00:00-03:00","r":1},
    {"h":"Costa do Marfim","hf":"https://flagcdn.com/w80/ci.png","a":"Equador","af":"https://flagcdn.com/w80/ec.png","g":"E","dt":"2026-06-14T20:00:00-03:00","r":1},
    {"h":"Alemanha","hf":"https://flagcdn.com/w80/de.png","a":"Costa do Marfim","af":"https://flagcdn.com/w80/ci.png","g":"E","dt":"2026-06-20T17:00:00-03:00","r":2},
    {"h":"Equador","hf":"https://flagcdn.com/w80/ec.png","a":"CuraÃ§ao","af":"https://flagcdn.com/w80/cw.png","g":"E","dt":"2026-06-20T21:00:00-03:00","r":2},
    {"h":"Equador","hf":"https://flagcdn.com/w80/ec.png","a":"Alemanha","af":"https://flagcdn.com/w80/de.png","g":"E","dt":"2026-06-25T17:00:00-03:00","r":3},
    {"h":"CuraÃ§ao","hf":"https://flagcdn.com/w80/cw.png","a":"Costa do Marfim","af":"https://flagcdn.com/w80/ci.png","g":"E","dt":"2026-06-25T17:00:00-03:00","r":3},
    {"h":"PaÃ­ses Baixos","hf":"https://flagcdn.com/w80/nl.png","a":"JapÃ£o","af":"https://flagcdn.com/w80/jp.png","g":"F","dt":"2026-06-14T17:00:00-03:00","r":1},
    {"h":"SuÃ©cia","hf":"https://flagcdn.com/w80/se.png","a":"TunÃ­sia","af":"https://flagcdn.com/w80/tn.png","g":"F","dt":"2026-06-14T23:00:00-03:00","r":1},
    {"h":"PaÃ­ses Baixos","hf":"https://flagcdn.com/w80/nl.png","a":"SuÃ©cia","af":"https://flagcdn.com/w80/se.png","g":"F","dt":"2026-06-20T14:00:00-03:00","r":2},
    {"h":"TunÃ­sia","hf":"https://flagcdn.com/w80/tn.png","a":"JapÃ£o","af":"https://flagcdn.com/w80/jp.png","g":"F","dt":"2026-06-21T01:00:00-03:00","r":2},
    {"h":"JapÃ£o","hf":"https://flagcdn.com/w80/jp.png","a":"SuÃ©cia","af":"https://flagcdn.com/w80/se.png","g":"F","dt":"2026-06-25T20:00:00-03:00","r":3},
    {"h":"TunÃ­sia","hf":"https://flagcdn.com/w80/tn.png","a":"PaÃ­ses Baixos","af":"https://flagcdn.com/w80/nl.png","g":"F","dt":"2026-06-25T20:00:00-03:00","r":3},
    {"h":"BÃ©lgica","hf":"https://flagcdn.com/w80/be.png","a":"Egito","af":"https://flagcdn.com/w80/eg.png","g":"G","dt":"2026-06-15T16:00:00-03:00","r":1},
    {"h":"IrÃ£","hf":"https://flagcdn.com/w80/ir.png","a":"Nova ZelÃ¢ndia","af":"https://flagcdn.com/w80/nz.png","g":"G","dt":"2026-06-15T22:00:00-03:00","r":1},
    {"h":"BÃ©lgica","hf":"https://flagcdn.com/w80/be.png","a":"IrÃ£","af":"https://flagcdn.com/w80/ir.png","g":"G","dt":"2026-06-21T16:00:00-03:00","r":2},
    {"h":"Nova ZelÃ¢ndia","hf":"https://flagcdn.com/w80/nz.png","a":"Egito","af":"https://flagcdn.com/w80/eg.png","g":"G","dt":"2026-06-21T22:00:00-03:00","r":2},
    {"h":"Egito","hf":"https://flagcdn.com/w80/eg.png","a":"IrÃ£","af":"https://flagcdn.com/w80/ir.png","g":"G","dt":"2026-06-27T00:00:00-03:00","r":3},
    {"h":"Nova ZelÃ¢ndia","hf":"https://flagcdn.com/w80/nz.png","a":"BÃ©lgica","af":"https://flagcdn.com/w80/be.png","g":"G","dt":"2026-06-27T00:00:00-03:00","r":3},
    {"h":"Espanha","hf":"https://flagcdn.com/w80/es.png","a":"Cabo Verde","af":"https://flagcdn.com/w80/cv.png","g":"H","dt":"2026-06-15T13:00:00-03:00","r":1},
    {"h":"ArÃ¡bia Saudita","hf":"https://flagcdn.com/w80/sa.png","a":"Uruguai","af":"https://flagcdn.com/w80/uy.png","g":"H","dt":"2026-06-15T19:00:00-03:00","r":1},
    {"h":"Espanha","hf":"https://flagcdn.com/w80/es.png","a":"ArÃ¡bia Saudita","af":"https://flagcdn.com/w80/sa.png","g":"H","dt":"2026-06-21T13:00:00-03:00","r":2},
    {"h":"Uruguai","hf":"https://flagcdn.com/w80/uy.png","a":"Cabo Verde","af":"https://flagcdn.com/w80/cv.png","g":"H","dt":"2026-06-21T19:00:00-03:00","r":2},
    {"h":"Cabo Verde","hf":"https://flagcdn.com/w80/cv.png","a":"ArÃ¡bia Saudita","af":"https://flagcdn.com/w80/sa.png","g":"H","dt":"2026-06-26T21:00:00-03:00","r":3},
    {"h":"Uruguai","hf":"https://flagcdn.com/w80/uy.png","a":"Espanha","af":"https://flagcdn.com/w80/es.png","g":"H","dt":"2026-06-26T21:00:00-03:00","r":3},
    {"h":"FranÃ§a","hf":"https://flagcdn.com/w80/fr.png","a":"Senegal","af":"https://flagcdn.com/w80/sn.png","g":"I","dt":"2026-06-16T16:00:00-03:00","r":1},
    {"h":"Iraque","hf":"https://flagcdn.com/w80/iq.png","a":"Noruega","af":"https://flagcdn.com/w80/no.png","g":"I","dt":"2026-06-16T19:00:00-03:00","r":1},
    {"h":"FranÃ§a","hf":"https://flagcdn.com/w80/fr.png","a":"Iraque","af":"https://flagcdn.com/w80/iq.png","g":"I","dt":"2026-06-22T18:00:00-03:00","r":2},
    {"h":"Noruega","hf":"https://flagcdn.com/w80/no.png","a":"Senegal","af":"https://flagcdn.com/w80/sn.png","g":"I","dt":"2026-06-22T21:00:00-03:00","r":2},
    {"h":"Noruega","hf":"https://flagcdn.com/w80/no.png","a":"FranÃ§a","af":"https://flagcdn.com/w80/fr.png","g":"I","dt":"2026-06-26T16:00:00-03:00","r":3},
    {"h":"Senegal","hf":"https://flagcdn.com/w80/sn.png","a":"Iraque","af":"https://flagcdn.com/w80/iq.png","g":"I","dt":"2026-06-26T16:00:00-03:00","r":3},
    {"h":"Argentina","hf":"https://flagcdn.com/w80/ar.png","a":"ArgÃ©lia","af":"https://flagcdn.com/w80/dz.png","g":"J","dt":"2026-06-16T22:00:00-03:00","r":1},
    {"h":"Ãustria","hf":"https://flagcdn.com/w80/at.png","a":"JordÃ¢nia","af":"https://flagcdn.com/w80/jo.png","g":"J","dt":"2026-06-17T01:00:00-03:00","r":1},
    {"h":"Argentina","hf":"https://flagcdn.com/w80/ar.png","a":"Ãustria","af":"https://flagcdn.com/w80/at.png","g":"J","dt":"2026-06-22T14:00:00-03:00","r":2},
    {"h":"JordÃ¢nia","hf":"https://flagcdn.com/w80/jo.png","a":"ArgÃ©lia","af":"https://flagcdn.com/w80/dz.png","g":"J","dt":"2026-06-23T00:00:00-03:00","r":2},
    {"h":"ArgÃ©lia","hf":"https://flagcdn.com/w80/dz.png","a":"Ãustria","af":"https://flagcdn.com/w80/at.png","g":"J","dt":"2026-06-27T23:00:00-03:00","r":3},
    {"h":"JordÃ¢nia","hf":"https://flagcdn.com/w80/jo.png","a":"Argentina","af":"https://flagcdn.com/w80/ar.png","g":"J","dt":"2026-06-27T23:00:00-03:00","r":3},
    {"h":"Portugal","hf":"https://flagcdn.com/w80/pt.png","a":"Rep. Dem. Congo","af":"https://flagcdn.com/w80/cd.png","g":"K","dt":"2026-06-17T14:00:00-03:00","r":1},
    {"h":"UzbequistÃ£o","hf":"https://flagcdn.com/w80/uz.png","a":"ColÃ´mbia","af":"https://flagcdn.com/w80/co.png","g":"K","dt":"2026-06-17T23:00:00-03:00","r":1},
    {"h":"Portugal","hf":"https://flagcdn.com/w80/pt.png","a":"UzbequistÃ£o","af":"https://flagcdn.com/w80/uz.png","g":"K","dt":"2026-06-23T14:00:00-03:00","r":2},
    {"h":"ColÃ´mbia","hf":"https://flagcdn.com/w80/co.png","a":"Rep. Dem. Congo","af":"https://flagcdn.com/w80/cd.png","g":"K","dt":"2026-06-23T23:00:00-03:00","r":2},
    {"h":"ColÃ´mbia","hf":"https://flagcdn.com/w80/co.png","a":"Portugal","af":"https://flagcdn.com/w80/pt.png","g":"K","dt":"2026-06-27T20:30:00-03:00","r":3},
    {"h":"Rep. Dem. Congo","hf":"https://flagcdn.com/w80/cd.png","a":"UzbequistÃ£o","af":"https://flagcdn.com/w80/uz.png","g":"K","dt":"2026-06-27T20:30:00-03:00","r":3},
    {"h":"Inglaterra","hf":"https://flagcdn.com/w80/gb-eng.png","a":"CroÃ¡cia","af":"https://flagcdn.com/w80/hr.png","g":"L","dt":"2026-06-17T17:00:00-03:00","r":1},
    {"h":"Gana","hf":"https://flagcdn.com/w80/gh.png","a":"PanamÃ¡","af":"https://flagcdn.com/w80/pa.png","g":"L","dt":"2026-06-17T20:00:00-03:00","r":1},
    {"h":"Inglaterra","hf":"https://flagcdn.com/w80/gb-eng.png","a":"Gana","af":"https://flagcdn.com/w80/gh.png","g":"L","dt":"2026-06-23T17:00:00-03:00","r":2},
    {"h":"PanamÃ¡","hf":"https://flagcdn.com/w80/pa.png","a":"CroÃ¡cia","af":"https://flagcdn.com/w80/hr.png","g":"L","dt":"2026-06-23T20:00:00-03:00","r":2},
    {"h":"PanamÃ¡","hf":"https://flagcdn.com/w80/pa.png","a":"Inglaterra","af":"https://flagcdn.com/w80/gb-eng.png","g":"L","dt":"2026-06-27T18:00:00-03:00","r":3},
    {"h":"CroÃ¡cia","hf":"https://flagcdn.com/w80/hr.png","a":"Gana","af":"https://flagcdn.com/w80/gh.png","g":"L","dt":"2026-06-27T18:00:00-03:00","r":3}
  ]'::jsonb;
begin
  -- Quando chamado via API (auth.uid() presente), exige admin da liga
  if auth.uid() is not null and not exists (
    select 1 from public.league_members
    where league_id = p_league_id
    and user_id = auth.uid()
    and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Apenas admin/owner da liga pode carregar jogos.';
  end if;

  select count(*) into v_existing from public.matches where league_id = p_league_id;
  if v_existing > 0 then
    return;
  end if;

  for v_match in select * from jsonb_array_elements(v_matches) loop
    v_home_id := null;
    v_away_id := null;

    insert into public.teams (name, flag_url, group_name)
    select v_match->>'h', v_match->>'hf', v_match->>'g'
    where not exists (select 1 from public.teams where name = v_match->>'h')
    returning id into v_home_id;
    if v_home_id is null then
      select id into v_home_id from public.teams where name = v_match->>'h' limit 1;
    end if;

    insert into public.teams (name, flag_url, group_name)
    select v_match->>'a', v_match->>'af', v_match->>'g'
    where not exists (select 1 from public.teams where name = v_match->>'a')
    returning id into v_away_id;
    if v_away_id is null then
      select id into v_away_id from public.teams where name = v_match->>'a' limit 1;
    end if;

    v_idx := v_idx + 1;
    insert into public.matches (
      league_id, match_number, home_team_id, away_team_id,
      scheduled_at, round, group_round, status,
      prediction_opens_at, prediction_closes_at
    ) values (
      p_league_id, v_idx, v_home_id, v_away_id,
      (v_match->>'dt')::timestamptz, 'GROUP', (v_match->>'r')::integer, 'UPCOMING',
      now(), (v_match->>'dt')::timestamptz - interval '1 hour'
    );
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

-- 3. Apaga jogos antigos e resemeia com o calendÃ¡rio correto.
-- ATENÃ‡ÃƒO: isto apaga palpites existentes ligados aos jogos antigos.
do $$
declare
  v_league_id uuid;
begin
  select id into v_league_id from public.leagues order by created_at limit 1;
  if v_league_id is null then
    raise notice 'Nenhuma liga encontrada â€” execute apÃ³s criar a liga.';
    return;
  end if;
  delete from public.predictions
  where match_id in (select id from public.matches where league_id = v_league_id);
  delete from public.matches where league_id = v_league_id;
  delete from public.teams where id not in (
    select home_team_id from public.matches union select away_team_id from public.matches
  );
  perform public.seed_league_matches(v_league_id);
  raise notice 'Liga % resemeada com 72 jogos.', v_league_id;
end;
$$;


