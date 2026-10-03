-- A whole league, start to pickups, as three users. Any failed check aborts.
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(u text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || u, false) $$;
create or replace function pg_temp.fails(q text, msg text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'expected "%" but it worked: %', msg, q;
exception when others then
  if sqlerrm not like '%' || msg || '%' then raise exception 'expected "%", got "%"', msg, sqlerrm; end if;
end $$;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'check failed: %', what; end if; end $$;

select pg_temp.as_user('a');
select create_league('Puck Bunnies', 'nhl', '20262027', 4,
  '{"slots":{"C":1,"G":1},"bench":0,"pickSeconds":90,"weeks":3}', 'Team A') as l \gset
select invite_code as code from leagues where id = :'l' \gset

select pg_temp.as_user('b');
select pg_temp.check(join_league(lower(:'code'), 'Team B') = :'l', 'join by code, any case');
select pg_temp.fails($$select join_league('NOPE00', 'x')$$, 'No league has that code');

-- C is not in it and sees nothing.
select pg_temp.as_user('c');
set role authenticated;
select pg_temp.check((select count(*) from leagues) = 0, 'outsider sees no league');
reset role;

select pg_temp.as_user('b');
select pg_temp.fails(format('select start_draft(%L, ''{}'', ''[]'', now())', :'l'), 'Only the commissioner');

select pg_temp.as_user('a');
select array_agg(id order by name) as ord from teams where league_id = :'l' \gset
select start_draft(:'l', :'ord',
  jsonb_build_array(jsonb_build_object('week', 1, 'home', (:'ord'::uuid[])[1], 'away', (:'ord'::uuid[])[2])), now());

select make_pick(:'l', '8478402', 'C', 'C');
select pg_temp.fails(format('select make_pick(%L, ''x'', ''C'', ''C'')', :'l'), 'not your pick');
select pg_temp.as_user('b');
select pg_temp.fails(format('select make_pick(%L, ''8478402'', ''C'', ''C'')', :'l'), 'already taken');
select make_pick(:'l', '1', 'G', 'G');
select make_pick(:'l', '2', 'C', 'C'); -- B again: the snake turns
select pg_temp.as_user('a');
select make_pick(:'l', '3', 'G', 'G');
select pg_temp.check((select status from leagues where id = :'l') = 'season', 'draft ends when rosters are full');

set role authenticated;
select pg_temp.check((select count(*) from roster) = 4, 'member sees every roster');
reset role;

select set_slot(:'l', '8478402', 'BN');
select pg_temp.fails(format('select set_slot(%L, ''1'', ''BN'')', :'l'), 'not on your team');
select add_drop(:'l', '9', 'C', '8478402');
select pg_temp.fails(format('select add_drop(%L, ''10'', ''C'', null)', :'l'), 'roster is full');
select pg_temp.check((select count(*) from lineup_log where league_id = :'l') = 7, 'every move logged');

select record_week(:'l', 1, jsonb_build_object((:'ord'::uuid[])[1], 12.5));
select record_week(:'l', 1, jsonb_build_object((:'ord'::uuid[])[1], 99));
select pg_temp.check((select points from week_scores) = 12.5, 'first recorded week wins');

\echo 'flow.sql: all checks passed'
