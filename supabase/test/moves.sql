-- Settings, lineups, IR, waivers (rolling + FAAB), add limits and trades,
-- as three users. Run after schema.sql; any failed check aborts.
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
-- Time travel for the tests: waivers and trade reviews end now.
create or replace function pg_temp.expire(l uuid) returns void language sql as $$
  update waivers set until = now() - interval '1 second' where league_id = l;
  update trades set review_until = now() - interval '1 second' where league_id = l and status = 'accepted';
$$;

-- Three teams, 2 starters (C, G) + 1 bench + 1 IR, linear draft, rolling waivers.
select pg_temp.as_user('a');
select create_league('Moves', 'nhl', '20262027', 3,
  '{"format":"h2h_points","slots":{"C":1,"G":1},"bench":1,"ir":1,"draftType":"linear","pickSeconds":90,"weeks":2,"playoffTeams":2,
    "waivers":{"type":"rolling","days":2,"budget":100},"trades":{"review":"commissioner","reviewHours":24,"vetoVotes":1,"deadline":null},
    "maxAddsPerWeek":0}', 'A') as l \gset
select invite_code as code from leagues where id = :'l' \gset
select pg_temp.as_user('b');
select join_league(:'code', 'B');
select pg_temp.as_user('c');
select join_league(:'code', 'C');

-- Commissioner can reshape the league before the draft.
select pg_temp.as_user('b');
select pg_temp.fails(format('select update_league(%L, ''x'', 3, ''{}'')', :'l'), 'Only the commissioner');
select pg_temp.as_user('a');
select pg_temp.fails(format('select update_league(%L, ''Moves'', 2, (select settings from leagues where id = %L))', :'l', :'l'), 'More teams have joined');

select array_agg(id order by name) as ord from teams where league_id = :'l' \gset
select start_draft(:'l', :'ord', '[]', now());
select pg_temp.check((select string_agg(name || waiver_rank, ',' order by name) from teams where league_id = :'l') = 'A3,B2,C1', 'waiver order is reverse draft order');

-- Linear: A, B, C every round.
select pg_temp.as_user('a'); select make_pick(:'l', 'a1', 'C', 'C');
select pg_temp.as_user('b'); select make_pick(:'l', 'b1', 'C', 'C');
select pg_temp.as_user('c'); select make_pick(:'l', 'c1', 'C', 'C');
select pg_temp.as_user('a'); select make_pick(:'l', 'a2', 'G', 'G');
select pg_temp.as_user('b'); select make_pick(:'l', 'b2', 'G', 'G');
select pg_temp.as_user('c'); select make_pick(:'l', 'c2', 'G', 'G');
select pg_temp.as_user('a'); select make_pick(:'l', 'a3', 'C', 'C'); -- C is full: lands on the bench
select pg_temp.check((select slot from roster where league_id = :'l' and player_id = 'a3') = 'BN', 'a pick into a full slot goes to the bench');
select pg_temp.as_user('b'); select make_pick(:'l', 'b3', 'C', 'BN');
select pg_temp.as_user('c'); select make_pick(:'l', 'c3', 'C', 'BN');
select pg_temp.check((select status from leagues where id = :'l') = 'season', 'draft done');

-- After the draft the league's shape is locked, other settings aren't.
select pg_temp.as_user('a');
select update_league(:'l', 'Moves', 9,
  (select settings || '{"bench": 9, "maxAddsPerWeek": 2}' from leagues where id = :'l'));
select pg_temp.check((select (settings ->> 'bench')::int = 1 and (settings ->> 'maxAddsPerWeek')::int = 2 and max_teams = 3 from leagues where id = :'l'),
  'bench and team count locked, add limit changed');

-- Lineups: swaps are checked together; wrong positions and full slots are refused.
select set_lineup(:'l', '[{"player":"a1","slot":"BN"},{"player":"a3","slot":"C"}]');
select pg_temp.check((select slot from roster where league_id = :'l' and player_id = 'a3') = 'C', 'swap worked');
select pg_temp.fails(format('select set_slot(%L, ''a1'', ''G'')', :'l'), 'doesn''t take that position');
select pg_temp.fails(format('select set_slot(%L, ''a1'', ''C'')', :'l'), 'C is full');
-- IR: a spot on top of the roster, so A can add after stashing someone there.
select set_slot(:'l', 'a1', 'IR');
select add_drop(:'l', 'fa1', 'C', null);
select pg_temp.check((select count(*) from roster where team_id = (select my_team(:'l'))) = 4, 'IR makes room');
select pg_temp.fails(format('select set_slot(%L, ''fa1'', ''IR'')', :'l'), 'IR spots are full');
select pg_temp.fails(format('select set_slot(%L, ''a1'', ''BN'')', :'l'), 'roster is full');

-- Waivers (rolling). A drops fa1 → on waivers; nobody can just add him.
select add_drop(:'l', null, null, 'fa1');
select pg_temp.as_user('b');
select pg_temp.fails(format('select add_drop(%L, ''fa1'', ''C'', null)', :'l'), 'on waivers');
select pg_temp.fails(format('select place_claim(%L, ''nobody'', ''C'', null, 0)', :'l'), 'not on waivers');
select place_claim(:'l', 'fa1', 'C', 'b3', 0);
select pg_temp.as_user('c');
select place_claim(:'l', 'fa1', 'C', 'c3', 0);
select pg_temp.check(process_waivers(:'l') = 0, 'nothing processes before waivers end');
select pg_temp.expire(:'l');
select pg_temp.check(process_waivers(:'l') = 1, 'one claim processed');
-- C had waiver rank 1, so C wins and goes to the back.
select pg_temp.check((select t.name from roster r join teams t on t.id = r.team_id where r.league_id = :'l' and r.player_id = 'fa1') = 'C', 'best waiver rank wins');
select pg_temp.check((select string_agg(name || waiver_rank, ',' order by name) from teams where league_id = :'l') = 'A2,B1,C3', 'winner moves to the back');
select pg_temp.as_user('b');
set role authenticated;
select pg_temp.check((select status from claims where player_id = 'fa1') = 'lost', 'B sees its own lost claim');
select pg_temp.check((select count(*) from claims) = 1, 'claims are private');
reset role;
-- c3 was dropped by C's claim, so it's now on waivers too.
select pg_temp.check(exists (select 1 from waivers where league_id = :'l' and player_id = 'c3'), 'claim drop goes to waivers');

-- Add limit: 2 a week.
select add_drop(:'l', 'fa2', 'C', 'b3');
select add_drop(:'l', 'fa3', 'C', 'fa2');
select pg_temp.fails(format('select add_drop(%L, ''fa4'', ''C'', ''fa3'')', :'l'), 'adds for this week');

-- Trades with commissioner review.
select pg_temp.as_user('b');
select (select id from teams where league_id = :'l' and name = 'C') as tc \gset
select (select id from teams where league_id = :'l' and name = 'A') as ta \gset
select pg_temp.fails(format('select propose_trade(%L, %L, ''{c1}'', ''{b1}'', null)', :'l', :'tc'), 'isn''t yours');
select propose_trade(:'l', :'tc', '{b1}', '{c1}', 'centers swap') as tr \gset
select pg_temp.fails(format('select respond_trade(%L, true)', :'tr'), 'isn''t to you');
select pg_temp.as_user('c');
select respond_trade(:'tr', true);
select pg_temp.check((select status from trades where id = :'tr') = 'accepted', 'waits for review');
select pg_temp.fails(format('select review_trade(%L, true)', :'tr'), 'Only the commissioner');
select pg_temp.as_user('a');
select review_trade(:'tr', true);
select pg_temp.check((select t.name from roster r join teams t on t.id = r.team_id where r.league_id = :'l' and r.player_id = 'b1') = 'C', 'b1 moved to C');
select pg_temp.check((select slot from roster where league_id = :'l' and player_id = 'c1') = 'BN', 'traded players arrive on the bench');

-- A trade nobody reviews goes through when its time is up.
select pg_temp.as_user('b');
select propose_trade(:'l', :'ta', '{b2}', '{a2}', null) as tr2 \gset
select pg_temp.as_user('a');
select respond_trade(:'tr2', true);
select pg_temp.check(process_trades(:'l') = 0, 'not before review ends');
select pg_temp.expire(:'l');
select pg_temp.check(process_trades(:'l') = 1, 'goes through after review');
select pg_temp.check((select status from trades where id = :'tr2') = 'completed', 'completed');

-- League vote: one veto (vetoVotes = 1) kills it.
select update_league(:'l', null, 3, (select jsonb_set(settings, '{trades,review}', '"vote"') from leagues where id = :'l'));
select pg_temp.as_user('c');
select propose_trade(:'l', :'ta', '{b1}', '{b2}', null) as tr3 \gset
select pg_temp.as_user('a');
select respond_trade(:'tr3', true);
select pg_temp.fails(format('select veto_vote(%L)', :'tr3'), 'not in the trade');
select pg_temp.as_user('b');
select veto_vote(:'tr3');
select pg_temp.check((select status from trades where id = :'tr3') = 'vetoed', 'vetoed by vote');

-- FAAB: highest bid wins, budget comes off.
select pg_temp.as_user('a');
select update_league(:'l', null, 3, (select jsonb_set(settings, '{waivers,type}', '"faab"') || '{"maxAddsPerWeek": 0}' from leagues where id = :'l'));
update teams set faab = 100 where league_id = :'l';
select pg_temp.as_user('a');
select add_drop(:'l', null, null, 'a3');
select pg_temp.as_user('b');
select pg_temp.fails(format('select place_claim(%L, ''a3'', ''C'', ''fa3'', 500)', :'l'), 'FAAB left');
select place_claim(:'l', 'a3', 'C', 'fa3', 30);
select pg_temp.as_user('c');
select place_claim(:'l', 'a3', 'C', 'b1', 31);
select pg_temp.expire(:'l');
select process_waivers(:'l');
select pg_temp.check((select t.name from roster r join teams t on t.id = r.team_id where r.league_id = :'l' and r.player_id = 'a3') = 'C', 'highest bid wins');
select pg_temp.check((select faab from teams where id = :'tc') = 69, 'bid comes off the budget');

-- Trade deadline.
select pg_temp.as_user('a');
select update_league(:'l', null, 3, (select jsonb_set(settings, '{trades,deadline}', '"2020-01-01"') from leagues where id = :'l'));
select pg_temp.fails(format('select propose_trade(%L, %L, ''{a2}'', ''{}'', null)', :'l', :'tc'), 'deadline has passed');

select pg_temp.check((select count(*) from transactions where league_id = :'l') >= 10, 'activity is logged');
\echo 'moves.sql: all checks passed'
