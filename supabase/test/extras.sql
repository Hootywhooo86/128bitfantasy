-- Commissioner tools, divisions, pick trading, auction drafts, keepers and
-- new seasons, multi-position players. Run after schema.sql.
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
create or replace function pg_temp.team(l uuid, n text) returns uuid language sql as
  $$ select id from teams where league_id = l and name = n $$;

-- ── Positions ──
select pg_temp.check(slot_takes('G', 'PG', 'nba') and slot_takes('F', 'SF/PF', 'nba') and slot_takes('UTIL', 'C', 'nba'), 'nba slots');
select pg_temp.check(not slot_takes('G', 'PG', 'nhl') and slot_takes('G', 'G', 'nhl'), 'hockey G is a goalie');
select pg_temp.check(slot_takes('UTIL', 'DH', 'mlb') and not slot_takes('UTIL', 'SP', 'mlb') and slot_takes('P', 'RP', 'mlb')
  and slot_takes('MI', 'SS', 'mlb') and slot_takes('CI', '1B', 'mlb') and slot_takes('SP', 'DH/SP', 'mlb'), 'mlb slots');

-- ── Snake league with pick trades, two teams, 2 rounds ──
select pg_temp.as_user('a');
select create_league('Picks', 'nba', '2026', 3,
  '{"format":"h2h_points","slots":{"G":1,"F":1},"bench":0,"ir":0,"draftType":"snake","pickSeconds":90,"weeks":2,"playoffTeams":0,
    "keepers":1,"waivers":{"type":"none","days":0,"budget":0},"trades":{"review":"none","reviewHours":0,"vetoVotes":1,"deadline":null},
    "maxAddsPerWeek":0}', 'A') as l \gset
select invite_code as code from leagues where id = :'l' \gset
select pg_temp.as_user('b');
select join_league(:'code', 'B');

-- Divisions and team edits are the commissioner's.
select pg_temp.fails(format('select commish_team(%L, ''x'', 1, null, null, null)', pg_temp.team(:'l', 'A')), 'Only the commissioner');
select pg_temp.as_user('a');
select commish_team(pg_temp.team(:'l', 'B'), 'Bees', 1, null, null, null);
select pg_temp.check((select name || division from teams where league_id = :'l' and division = 1) = 'Bees1', 'renamed and put in division 1');

-- Before the draft, A trades its round-1 pick to Bees for Bees' round-2 pick.
select pg_temp.team(:'l', 'A') as ta \gset
select pg_temp.team(:'l', 'Bees') as tb \gset
select propose_trade(:'l', :'tb', '{}', '{}', null, array['2026:1:' || :'ta'], array['2026:2:' || :'tb']) as tr \gset
select pg_temp.fails(format('select propose_trade(%L, %L, ''{}'', ''{}'', null, array[%L], ''{}'')', :'l', :'tb', '2026:1:' || :'tb'), 'isn''t yours to trade');
select pg_temp.fails(format('select propose_trade(%L, %L, ''{}'', ''{}'', null, array[%L], ''{}'')', :'l', :'tb', '2026:9:' || :'ta'), 'isn''t yours to trade');
select pg_temp.as_user('b');
select respond_trade(:'tr', true);
select pg_temp.check(pick_owner(:'l', '2026', 1, :'ta') = :'tb', 'round 1 pick moved');

select pg_temp.as_user('a');
select start_draft(:'l', array[:'ta', :'tb']::uuid[], '[]', now());
-- Pick 1 is A's original round-1 pick, now owned by Bees.
select pg_temp.check(on_clock(:'l') = :'tb', 'Bees pick first with A''s pick');
select pg_temp.fails(format('select make_pick(%L, ''g1'', ''PG'')', :'l'), 'not your pick');
select pg_temp.as_user('b');
select make_pick(:'l', 'g1', 'PG');
select make_pick(:'l', 'f1', 'SF/PF');
select pg_temp.check((select string_agg(player_id || ':' || slot, ',' order by player_id) from roster where league_id = :'l') = 'f1:F,g1:G',
  'picks land in the spot they fit');
-- A's own round-1 pick has been used; it can't be traded any more.
select pg_temp.fails(format('select propose_trade(%L, %L, ''{}'', ''{}'', null, array[%L], ''{}'')', :'l', :'ta', '2026:1:' || :'tb'), 'isn''t yours to trade');
-- Round 2 (snake reverses: Bees' original, then A's): A owns both.
select pg_temp.as_user('a');
select pg_temp.check(on_clock(:'l') = :'ta', 'A picks twice in round 2');
select make_pick(:'l', 'g2', 'SG');
select make_pick(:'l', 'f2', 'PF');
select pg_temp.check((select status from leagues where id = :'l') = 'season', 'draft over after 2 rounds');

-- Commissioner tools.
select commish_move(:'l', 'f2', 'PF', :'tb', 'BN');
select pg_temp.check((select team_id from roster where league_id = :'l' and player_id = 'f2') = :'tb', 'commish moved a player');
select commish_move(:'l', 'g2', 'SG', null, null);
select pg_temp.check(not exists (select 1 from roster where league_id = :'l' and player_id = 'g2'), 'commish released a player');
select commish_lineup(:'l', :'tb', '[{"player":"f1","slot":"BN"},{"player":"f2","slot":"F"}]');
select pg_temp.check((select slot from roster where league_id = :'l' and player_id = 'f2') = 'F', 'commish set a lineup');
select pg_temp.fails(format('select commish_lineup(%L, %L, ''[{"player":"g1","slot":"F"}]'')', :'l', :'tb'), 'doesn''t take that position');

-- Next season's picks can be traded during this one.
select propose_trade(:'l', :'tb', '{}', '{}', null, array['2027:1:' || :'ta'], '{}') as tr2 \gset
select pg_temp.as_user('b');
select respond_trade(:'tr2', true);

-- ── New season with keepers ──
select pg_temp.as_user('b');
select pg_temp.fails(format('select new_season(%L, ''2027'')', :'l'), 'Only the commissioner');
select pg_temp.as_user('a');
select pg_temp.fails(format('select new_season(%L, ''2025'')', :'l'), 'must come after');
select new_season(:'l', '2027') as l2 \gset
select pg_temp.check((select status from leagues where id = :'l') = 'done', 'old season closed');
select pg_temp.check((select count(*) from teams where league_id = :'l2') = 2, 'teams carried over');
select pg_temp.check((select division from teams where league_id = :'l2' and name = 'Bees') = 1, 'divisions carried over');
select pg_temp.team(:'l2', 'A') as na \gset
select pg_temp.team(:'l2', 'Bees') as nb \gset
select pg_temp.check(pick_owner(:'l2', '2027', 1, :'na') = :'nb', 'next-season pick trade carried over');
select pg_temp.fails(format('select new_season(%L, ''2028'')', :'l'), 'already been started');

-- Keepers: up to 1, only from your own final roster.
select pg_temp.fails(format('select set_keepers(%L, ''{g1}'')', :'l2'), 'only keep players who finished last season on your team');
select pg_temp.as_user('b');
select pg_temp.fails(format('select set_keepers(%L, ''{f1,f2}'')', :'l2'), 'at most 1');
select set_keepers(:'l2', '{f2}');
select pg_temp.as_user('a');
select start_draft(:'l2', array[:'na', :'nb']::uuid[], '[]', now());
select pg_temp.check((select team_id from roster where league_id = :'l2' and player_id = 'f2') = :'nb', 'keeper on his team');
-- 2 roster spots minus 1 keeper = 1 round. Pick 1 was A's, traded to Bees.
select pg_temp.check(league_rounds(:'l2') = 1 and league_rounds(:'l') = 2, 'keepers shorten the draft after the first season');
select pg_temp.as_user('b');
select pg_temp.fails(format('select make_pick(%L, ''f2'', ''PF'')', :'l2'), 'already taken');
select make_pick(:'l2', 'g9', 'PG');
-- A traded its only pick away, so Bees pick again.
select make_pick(:'l2', 'g8', 'PG');
select pg_temp.check((select status from leagues where id = :'l2') = 'season', 'one-round draft done');

-- ── Auction ──
select pg_temp.as_user('a');
select create_league('Auction', 'nhl', '20262027', 2,
  '{"format":"h2h_points","slots":{"C":1,"G":1},"bench":0,"ir":0,"draftType":"auction","auctionBudget":10,"bidSeconds":20,
    "pickSeconds":90,"weeks":1,"playoffTeams":0,"waivers":{"type":"none","days":0,"budget":0},
    "trades":{"review":"none","reviewHours":0,"vetoVotes":1,"deadline":null},"maxAddsPerWeek":0}', 'A') as la \gset
select invite_code as code from leagues where id = :'la' \gset
select pg_temp.as_user('b');
select join_league(:'code', 'B');
select pg_temp.as_user('a');
select pg_temp.team(:'la', 'A') as aa \gset
select pg_temp.team(:'la', 'B') as ab \gset
select start_draft(:'la', array[:'aa', :'ab']::uuid[], '[]', now());
select pg_temp.fails(format('select make_pick(%L, ''x'', ''C'')', :'la'), 'auction draft');
select pg_temp.as_user('b');
select pg_temp.fails(format('select nominate(%L, ''c1'', ''C'', 1)', :'la'), 'not your turn to nominate');
select pg_temp.as_user('a');
-- Budget 10, 2 spots: at most $9 (keep $1 for the other spot).
select pg_temp.fails(format('select nominate(%L, ''c1'', ''C'', 10)', :'la'), 'Opening bid must be');
select nominate(:'la', 'c1', 'C', 2);
select pg_temp.fails(format('select place_bid(%L, 3)', :'la'), 'You can bid at most') where false;
select pg_temp.as_user('b');
select pg_temp.fails(format('select place_bid(%L, 2)', :'la'), 'Bid more than');
select place_bid(:'la', 5);
select pg_temp.fails(format('select close_lot(%L)', :'la'), 'still open');
update leagues set lot = lot || jsonb_build_object('ends_at', now() - interval '1 second') where id = :'la';
select close_lot(:'la');
select pg_temp.check((select team_id from roster where league_id = :'la' and player_id = 'c1') = :'ab', 'B bought c1');
select pg_temp.check((select budget from teams where id = :'ab') = 5 and (select price from picks where league_id = :'la' and player_id = 'c1') = 5, 'paid $5');
-- Next to nominate: B (after A). B has $5 and 1 spot left: max $5.
select nominate(:'la', 'g1', 'G', 5);
update leagues set lot = lot || jsonb_build_object('ends_at', now() - interval '1 second') where id = :'la';
select close_lot(:'la');
select pg_temp.check(draft_needs(:'la', :'ab') = 0, 'B is full');
-- Only A still needs players, so A nominates both remaining.
select pg_temp.as_user('a');
select pg_temp.check(nominator(:'la') = :'aa', 'A nominates next');
select nominate(:'la', 'c2', 'C', 1);
update leagues set lot = lot || jsonb_build_object('ends_at', now() - interval '1 second') where id = :'la';
select close_lot(:'la');
select nominate(:'la', 'g2', 'G', 1);
update leagues set lot = lot || jsonb_build_object('ends_at', now() - interval '1 second') where id = :'la';
select close_lot(:'la');
select pg_temp.check((select status from leagues where id = :'la') = 'season', 'auction done when every roster is full');

\echo 'extras.sql: all checks passed'
