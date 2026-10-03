-- 128BIT LEAGUES — the database for leagues hosted by 128BIT FANTASY.
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste all of it → Run. Running it again is safe.
--
-- Everyone reads only the leagues they're in (row-level security). Nobody
-- writes tables directly: every change goes through the functions at the
-- bottom, which check it's your turn / your team / your league first.
-- Points are never stored per game — they come from the NHL and Sleeper
-- stat feeds, applied to lineup_log, so nobody can type in a score.

create extension if not exists pgcrypto;

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  sport text not null check (sport in ('nhl', 'nfl')),
  season text not null,
  invite_code text not null unique,
  commissioner uuid not null references auth.users (id) on delete cascade,
  max_teams int not null default 12 check (max_teams between 2 and 20),
  status text not null default 'setup' check (status in ('setup', 'drafting', 'season', 'done')),
  settings jsonb not null,
  draft_order uuid[] not null default '{}',
  season_start timestamptz,
  last_pick_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  unique (league_id, owner)
);

create table if not exists picks (
  league_id uuid not null references leagues (id) on delete cascade,
  pick_no int not null,
  team_id uuid not null references teams (id) on delete cascade,
  player_id text not null,
  auto boolean not null default false,
  made_at timestamptz not null default now(),
  primary key (league_id, pick_no),
  unique (league_id, player_id)
);

-- Who has whom right now. One team per player per league.
create table if not exists roster (
  league_id uuid not null references leagues (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  player_id text not null,
  position text not null,
  slot text not null,
  primary key (league_id, player_id)
);

-- Every lineup move, stamped with the server's clock. A player's game counts
-- if this log had him in a starting slot when the game started.
create table if not exists lineup_log (
  id bigint generated always as identity primary key,
  league_id uuid not null references leagues (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  player_id text not null,
  slot text, -- null = left the team
  at timestamptz not null default now()
);
create index if not exists lineup_log_league on lineup_log (league_id, team_id);

create table if not exists matchups (
  league_id uuid not null references leagues (id) on delete cascade,
  week int not null,
  home uuid not null references teams (id) on delete cascade,
  away uuid references teams (id) on delete cascade
);
create index if not exists matchups_league on matchups (league_id, week);

-- Finished weeks, so standings don't re-read a season of box scores.
-- First member to finish the maths for a week records it.
create table if not exists week_scores (
  league_id uuid not null references leagues (id) on delete cascade,
  week int not null,
  team_id uuid not null references teams (id) on delete cascade,
  points numeric not null,
  primary key (league_id, week, team_id)
);
-- The week's summed stat line, for category and roto formats.
alter table week_scores add column if not exists line jsonb not null default '{}';

-- Waiver order (1 = first claim) and FAAB left.
alter table teams add column if not exists waiver_rank int;
alter table teams add column if not exists faab int not null default 0;

-- Dropped players sit here until they clear waivers.
create table if not exists waivers (
  league_id uuid not null references leagues (id) on delete cascade,
  player_id text not null,
  until timestamptz not null,
  primary key (league_id, player_id)
);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  player_id text not null,
  position text not null,
  drop_player text,
  bid int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists claims_one_pending on claims (league_id, team_id, player_id) where status = 'pending';

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  from_team uuid not null references teams (id) on delete cascade,
  to_team uuid not null references teams (id) on delete cascade,
  give text[] not null default '{}', -- from_team's players
  get text[] not null default '{}',  -- to_team's players
  note text,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'completed', 'rejected', 'cancelled', 'vetoed', 'failed')),
  review_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trade_votes (
  trade_id uuid not null references trades (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  primary key (trade_id, team_id)
);

-- League activity: adds, drops, waiver wins, trades.
create table if not exists transactions (
  id bigint generated always as identity primary key,
  league_id uuid not null references leagues (id) on delete cascade,
  team_id uuid references teams (id) on delete cascade,
  kind text not null, -- add, drop, waiver, trade, commish
  player_id text,
  detail text,
  at timestamptz not null default now()
);
create index if not exists transactions_league on transactions (league_id, at desc);

-- ── Who can read what ────────────────────────────────────────────────────

create or replace function is_member(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where league_id = l and owner = auth.uid());
$$;

-- Supabase grants these by default; spelled out so a fresh project matches.
grant usage on schema public to authenticated;
grant select on leagues, teams, picks, roster, lineup_log, matchups, week_scores, waivers, claims, trades, trade_votes, transactions
  to authenticated;

do $$
declare t text;
begin
  foreach t in array array['leagues', 'teams', 'picks', 'roster', 'lineup_log', 'matchups', 'week_scores', 'waivers', 'trades', 'trade_votes', 'transactions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "members read" on %I', t);
    execute format('create policy "members read" on %I for select using (is_member(%s))', t, case when t = 'leagues' then 'id' when t = 'trade_votes' then '(select league_id from trades where id = trade_id)' else 'league_id' end);
  end loop;
end $$;

-- Claims are private: you see your own, never who else bid.
alter table claims enable row level security;
drop policy if exists "members read" on claims;
drop policy if exists "own claims" on claims;
create policy "own claims" on claims for select using (team_id = (select id from teams where league_id = claims.league_id and owner = auth.uid()));

-- Live draft boards and trade offers: phones get them the moment they happen.
do $$ begin alter publication supabase_realtime add table picks; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table leagues; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table trades; exception when others then null; end $$;

-- ── Helpers ──────────────────────────────────────────────────────────────

create or replace function my_team(l uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from teams where league_id = l and owner = auth.uid();
$$;

-- Starters + bench. IR spots are extra and don't count.
create or replace function roster_size(settings jsonb) returns int
language sql immutable as $$
  select coalesce((select sum(value::int) from jsonb_each_text(settings -> 'slots')), 0)
       + coalesce((settings ->> 'bench')::int, 0);
$$;

-- The team on the clock for a pick. Snake reverses every other round; linear doesn't. Matches draft.ts.
create or replace function draft_team(draft_order uuid[], pick_no int, draft_type text default 'snake') returns uuid
language sql immutable as $$
  select case when draft_type = 'linear' or (pick_no / array_length(draft_order, 1)) % 2 = 0
    then draft_order[(pick_no % array_length(draft_order, 1)) + 1]
    else draft_order[array_length(draft_order, 1) - (pick_no % array_length(draft_order, 1))]
  end;
$$;

-- Which positions a lineup slot takes. Matches SLOT_ACCEPTS in types.ts.
create or replace function slot_takes(slot text, pos text) returns boolean
language sql immutable as $$
  select case slot
    when 'BN' then true
    when 'IR' then true
    when 'UTIL' then pos in ('C', 'LW', 'RW', 'D')
    when 'F' then pos in ('C', 'LW', 'RW')
    when 'FLEX' then pos in ('RB', 'WR', 'TE')
    when 'SUPERFLEX' then pos in ('QB', 'RB', 'WR', 'TE')
    else slot = pos
  end;
$$;

-- Players on a team who count against the roster limit (not IR).
create or replace function active_count(l uuid, t uuid) returns int
language sql stable as $$
  select count(*)::int from roster where league_id = l and team_id = t and slot <> 'IR';
$$;

-- One roster move, logged with the server clock.
create or replace function put_player(l uuid, t uuid, p text, pos text, s text) returns void
language plpgsql as $$
begin
  if s is null then
    delete from roster where league_id = l and player_id = p and team_id = t;
  else
    insert into roster (league_id, team_id, player_id, position, slot) values (l, t, p, pos, s)
    on conflict (league_id, player_id) do update set team_id = excluded.team_id, slot = excluded.slot;
  end if;
  insert into lineup_log (league_id, team_id, player_id, slot) values (l, t, p, s);
end $$;

-- After any lineup change: every slot within its count, every player in a slot he can play.
create or replace function check_lineup(l uuid, t uuid) returns void
language plpgsql as $$
declare
  st jsonb := (select settings from leagues where id = l);
  bad text;
begin
  select r.player_id into bad from roster r where r.league_id = l and r.team_id = t and not slot_takes(r.slot, r.position) limit 1;
  if bad is not null then raise exception 'That spot doesn''t take that position.'; end if;
  select r.slot into bad from roster r where r.league_id = l and r.team_id = t and r.slot not in ('BN', 'IR')
    group by r.slot having count(*) > coalesce((st -> 'slots' ->> r.slot)::int, 0) limit 1;
  if bad is not null then raise exception '% is full.', bad; end if;
  if (select count(*) from roster where league_id = l and team_id = t and slot = 'IR') > coalesce((st ->> 'ir')::int, 0) then
    raise exception 'Your IR spots are full.';
  end if;
  if active_count(l, t) > roster_size(st) then raise exception 'Your roster is full — drop someone first.'; end if;
end $$;

-- ── Everything a phone can do ────────────────────────────────────────────

create or replace function create_league(p_name text, p_sport text, p_season text, p_max_teams int, p_settings jsonb, p_team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l uuid;
  code text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  loop
    -- 6 letters, no look-alikes (no I, L, O, 0, 1).
    code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from leagues where invite_code = code);
  end loop;
  insert into leagues (name, sport, season, invite_code, commissioner, max_teams, settings)
  values (p_name, p_sport, p_season, code, auth.uid(), p_max_teams, p_settings)
  returning id into l;
  insert into teams (league_id, owner, name) values (l, auth.uid(), p_team_name);
  return l;
end $$;

-- Commissioner. Before the draft anything goes; after it, the shape of the
-- league (format, lineup, bench, categories, weeks, draft) is fixed and only
-- the rest (scoring, IR, playoffs, waivers, trades, limits) can change.
create or replace function update_league(p_league uuid, p_name text, p_max_teams int, p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  merged jsonb;
begin
  select * into lg from leagues where id = p_league for update;
  if lg.commissioner is distinct from auth.uid() then raise exception 'Only the commissioner can change settings.'; end if;
  merged := p_settings;
  if lg.status <> 'setup' then
    merged := merged || jsonb_strip_nulls(jsonb_build_object(
      'format', lg.settings -> 'format', 'slots', lg.settings -> 'slots', 'bench', lg.settings -> 'bench',
      'categories', lg.settings -> 'categories', 'weeks', lg.settings -> 'weeks', 'draftType', lg.settings -> 'draftType'));
    p_max_teams := lg.max_teams;
  elsif p_max_teams < (select count(*) from teams where league_id = p_league) then
    raise exception 'More teams have joined than that.';
  end if;
  update leagues set name = coalesce(nullif(trim(p_name), ''), name), max_teams = p_max_teams, settings = merged where id = p_league;
  insert into transactions (league_id, kind, detail) values (p_league, 'commish', 'League settings changed');
end $$;

create or replace function join_league(p_code text, p_team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into lg from leagues where invite_code = upper(trim(p_code));
  if lg.id is null then raise exception 'No league has that code.'; end if;
  if exists (select 1 from teams where league_id = lg.id and owner = auth.uid()) then return lg.id; end if;
  if lg.status <> 'setup' then raise exception 'That league has already drafted.'; end if;
  if (select count(*) from teams where league_id = lg.id) >= lg.max_teams then raise exception 'That league is full.'; end if;
  insert into teams (league_id, owner, name) values (lg.id, auth.uid(), p_team_name);
  return lg.id;
end $$;

-- Commissioner only. The phone shuffles the order and builds the schedule
-- (draft.ts / season.ts) so there is one implementation of each.
create or replace function start_draft(p_league uuid, p_order uuid[], p_schedule jsonb, p_season_start timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
begin
  select * into lg from leagues where id = p_league;
  if lg.commissioner is distinct from auth.uid() then raise exception 'Only the commissioner can start the draft.'; end if;
  if lg.status <> 'setup' then raise exception 'The draft has already started.'; end if;
  if (select count(*) from teams where league_id = p_league) < 2 then raise exception 'Invite at least one friend first.'; end if;
  if array_length(p_order, 1) <> (select count(*) from teams where league_id = p_league)
     or exists (select 1 from unnest(p_order) t where t not in (select id from teams where league_id = p_league)) then
    raise exception 'The draft order must list every team once.';
  end if;
  insert into matchups (league_id, week, home, away)
  select p_league, (m ->> 'week')::int, (m ->> 'home')::uuid, nullif(m ->> 'away', '')::uuid
  from jsonb_array_elements(p_schedule) m;
  -- First waiver claim goes to the last pick of round one.
  update teams t set waiver_rank = array_length(p_order, 1) - array_position(p_order, t.id) + 1,
    faab = coalesce((lg.settings -> 'waivers' ->> 'budget')::int, 100)
  where t.league_id = p_league;
  update leagues set status = 'drafting', draft_order = p_order, season_start = p_season_start, last_pick_at = now()
  where id = p_league;
end $$;

-- Your pick when you're on the clock. Anyone in the league may also pick
-- for the team on the clock once its time has run out (auto-pick).
create or replace function make_pick(p_league uuid, p_player text, p_position text, p_slot text)
returns void language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  n int;
  on_clock uuid;
  is_auto boolean := false;
begin
  select * into lg from leagues where id = p_league for update;
  if not is_member(p_league) then raise exception 'You are not in this league.'; end if;
  if lg.status <> 'drafting' then raise exception 'The draft is not running.'; end if;
  select count(*) into n from picks where league_id = p_league;
  on_clock := draft_team(lg.draft_order, n, coalesce(lg.settings ->> 'draftType', 'snake'));
  if on_clock is distinct from my_team(p_league) then
    if now() < lg.last_pick_at + make_interval(secs => coalesce((lg.settings ->> 'pickSeconds')::int, 90)) then
      raise exception 'It is not your pick.';
    end if;
    is_auto := true;
  end if;
  if exists (select 1 from roster where league_id = p_league and player_id = p_player) then
    raise exception 'That player is already taken.';
  end if;
  insert into picks (league_id, pick_no, team_id, player_id, auto) values (p_league, n, on_clock, p_player, is_auto);
  perform put_player(p_league, on_clock, p_player, p_position, case when slot_takes(p_slot, p_position) then p_slot else 'BN' end);
  -- A full slot sends the pick to the bench rather than failing the draft.
  begin
    perform check_lineup(p_league, on_clock);
  exception when others then
    update roster set slot = 'BN' where league_id = p_league and player_id = p_player;
  end;
  update leagues set last_pick_at = now(),
    status = case when n + 1 >= array_length(draft_order, 1) * roster_size(settings) then 'season' else status end
  where id = p_league;
end $$;

-- Several lineup moves at once (a swap is two), checked together at the end.
create or replace function set_lineup(p_league uuid, p_moves jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  t uuid := my_team(p_league);
  m jsonb;
begin
  if t is null then raise exception 'You are not in this league.'; end if;
  for m in select * from jsonb_array_elements(p_moves) loop
    update roster set slot = m ->> 'slot' where league_id = p_league and player_id = m ->> 'player' and team_id = t;
    if not found then raise exception 'That player is not on your team.'; end if;
    insert into lineup_log (league_id, team_id, player_id, slot) values (p_league, t, m ->> 'player', m ->> 'slot');
  end loop;
  perform check_lineup(p_league, t);
end $$;

create or replace function set_slot(p_league uuid, p_player text, p_slot text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_lineup(p_league, jsonb_build_array(jsonb_build_object('player', p_player, 'slot', p_slot)));
end $$;

-- Adds in the last 7 days, for the weekly limit.
create or replace function recent_adds(l uuid, t uuid) returns int
language sql stable as $$
  select count(*)::int from transactions where league_id = l and team_id = t and kind in ('add', 'waiver', 'trade-in') and at > now() - interval '7 days';
$$;

create or replace function drop_to_waivers(l uuid, t uuid, p text) returns void
language plpgsql as $$
declare
  st jsonb := (select settings from leagues where id = l);
  d int := coalesce((st -> 'waivers' ->> 'days')::int, 2);
begin
  perform put_player(l, t, p, null, null);
  insert into transactions (league_id, team_id, kind, player_id) values (l, t, 'drop', p);
  if coalesce(st -> 'waivers' ->> 'type', 'rolling') <> 'none' and d > 0 then
    insert into waivers (league_id, player_id, until) values (l, p, now() + make_interval(days => d))
    on conflict (league_id, player_id) do update set until = excluded.until;
  end if;
end $$;

-- Free-agent pickup, optionally dropping someone to make room.
create or replace function add_drop(p_league uuid, p_add text, p_add_position text, p_drop text)
returns void language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  t uuid := my_team(p_league);
  w waivers;
  cap int;
begin
  select * into lg from leagues where id = p_league for update;
  if t is null then raise exception 'You are not in this league.'; end if;
  if lg.status <> 'season' then raise exception 'Pickups open after the draft.'; end if;
  if p_drop is not null then
    if not exists (select 1 from roster where league_id = p_league and player_id = p_drop and team_id = t) then
      raise exception 'That player is not on your team.';
    end if;
    perform drop_to_waivers(p_league, t, p_drop);
  end if;
  if p_add is not null then
    if exists (select 1 from roster where league_id = p_league and player_id = p_add) then
      raise exception 'Someone already has that player.';
    end if;
    select * into w from waivers where league_id = p_league and player_id = p_add and until > now();
    if w.player_id is not null then
      raise exception 'He''s on waivers until % — put in a claim instead.', to_char(w.until at time zone 'UTC', 'Dy HH24:MI "UTC"');
    end if;
    cap := coalesce((lg.settings ->> 'maxAddsPerWeek')::int, 0);
    if cap > 0 and recent_adds(p_league, t) >= cap then
      raise exception 'You''ve used your % adds for this week.', cap;
    end if;
    perform put_player(p_league, t, p_add, p_add_position, 'BN');
    perform check_lineup(p_league, t);
    insert into transactions (league_id, team_id, kind, player_id) values (p_league, t, 'add', p_add);
  end if;
end $$;

-- A waiver claim: one per player per team; a new one replaces the old.
create or replace function place_claim(p_league uuid, p_player text, p_position text, p_drop text, p_bid int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  t uuid := my_team(p_league);
  c uuid;
begin
  select * into lg from leagues where id = p_league;
  if t is null then raise exception 'You are not in this league.'; end if;
  if lg.status <> 'season' then raise exception 'Waivers open after the draft.'; end if;
  if exists (select 1 from roster where league_id = p_league and player_id = p_player) then raise exception 'Someone already has that player.'; end if;
  if not exists (select 1 from waivers where league_id = p_league and player_id = p_player and until > now()) then
    raise exception 'He''s not on waivers — just add him.';
  end if;
  if p_drop is not null and not exists (select 1 from roster where league_id = p_league and player_id = p_drop and team_id = t) then
    raise exception 'That player is not on your team.';
  end if;
  if lg.settings -> 'waivers' ->> 'type' = 'faab' and (p_bid < 0 or p_bid > (select faab from teams where id = t)) then
    raise exception 'You have $% of FAAB left.', (select faab from teams where id = t);
  end if;
  update claims set status = 'cancelled', processed_at = now()
  where league_id = p_league and team_id = t and player_id = p_player and status = 'pending';
  insert into claims (league_id, team_id, player_id, position, drop_player, bid)
  values (p_league, t, p_player, p_position, p_drop, greatest(coalesce(p_bid, 0), 0)) returning id into c;
  return c;
end $$;

create or replace function cancel_claim(p_claim uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update claims set status = 'cancelled', processed_at = now()
  where id = p_claim and status = 'pending' and team_id = (select id from teams where league_id = claims.league_id and owner = auth.uid());
end $$;

-- Runs every claim on every player whose waivers have ended. Anyone in the
-- league can call it; it does the same thing whoever does.
-- FAAB: highest bid wins, ties to waiver order. Rolling: best waiver order
-- wins and that team drops to the back of the line.
create or replace function process_waivers(p_league uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  w record;
  c record;
  done int := 0;
  faab_mode boolean;
  cap int;
begin
  select * into lg from leagues where id = p_league for update;
  if not is_member(p_league) then raise exception 'You are not in this league.'; end if;
  faab_mode := lg.settings -> 'waivers' ->> 'type' = 'faab';
  cap := coalesce((lg.settings ->> 'maxAddsPerWeek')::int, 0);
  for w in select * from waivers where league_id = p_league and until <= now() order by until loop
    for c in
      select cl.*, tm.waiver_rank, tm.faab from claims cl join teams tm on tm.id = cl.team_id
      where cl.league_id = p_league and cl.player_id = w.player_id and cl.status = 'pending'
      order by case when faab_mode then -cl.bid else 0 end, tm.waiver_rank nulls last, cl.created_at
    loop
      if exists (select 1 from roster where league_id = p_league and player_id = c.player_id) then
        update claims set status = 'lost', note = 'Already taken', processed_at = now() where id = c.id;
        continue;
      end if;
      if c.drop_player is not null and not exists (select 1 from roster where league_id = p_league and player_id = c.drop_player and team_id = c.team_id) then
        update claims set status = 'lost', note = 'The player to drop is gone', processed_at = now() where id = c.id;
        continue;
      end if;
      if active_count(p_league, c.team_id) - (case when c.drop_player is null then 0 else 1 end) >= roster_size(lg.settings) then
        update claims set status = 'lost', note = 'Roster full', processed_at = now() where id = c.id;
        continue;
      end if;
      if faab_mode and c.bid > c.faab then
        update claims set status = 'lost', note = 'Not enough FAAB', processed_at = now() where id = c.id;
        continue;
      end if;
      if cap > 0 and recent_adds(p_league, c.team_id) >= cap then
        update claims set status = 'lost', note = 'Weekly add limit', processed_at = now() where id = c.id;
        continue;
      end if;
      -- Winner.
      if c.drop_player is not null then perform drop_to_waivers(p_league, c.team_id, c.drop_player); end if;
      perform put_player(p_league, c.team_id, c.player_id, c.position, 'BN');
      insert into transactions (league_id, team_id, kind, player_id, detail)
      values (p_league, c.team_id, 'waiver', c.player_id, case when faab_mode then '$' || c.bid else null end);
      update claims set status = 'won', processed_at = now() where id = c.id;
      if faab_mode then
        update teams set faab = faab - c.bid where id = c.team_id;
      else
        update teams set waiver_rank = waiver_rank - 1 where league_id = p_league and waiver_rank > c.waiver_rank;
        update teams set waiver_rank = (select count(*) from teams where league_id = p_league) where id = c.team_id;
      end if;
      done := done + 1;
      exit;
    end loop;
    update claims set status = 'lost', note = coalesce(note, 'Outbid or lower priority'), processed_at = now()
    where league_id = p_league and player_id = w.player_id and status = 'pending';
    delete from waivers where league_id = p_league and player_id = w.player_id;
  end loop;
  return done;
end $$;

-- ── Trades ───────────────────────────────────────────────────────────────

create or replace function propose_trade(p_league uuid, p_to uuid, p_give text[], p_get text[], p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  t uuid := my_team(p_league);
  id uuid;
begin
  select * into lg from leagues where leagues.id = p_league;
  if t is null then raise exception 'You are not in this league.'; end if;
  if lg.status <> 'season' then raise exception 'Trades open after the draft.'; end if;
  if nullif(lg.settings -> 'trades' ->> 'deadline', '') is not null and current_date > (lg.settings -> 'trades' ->> 'deadline')::date then
    raise exception 'The trade deadline has passed.';
  end if;
  if p_to = t or not exists (select 1 from teams where teams.id = p_to and league_id = p_league) then raise exception 'Pick another team in this league.'; end if;
  if coalesce(array_length(p_give, 1), 0) + coalesce(array_length(p_get, 1), 0) = 0 then raise exception 'Add at least one player.'; end if;
  if exists (select 1 from unnest(p_give) p where not exists (select 1 from roster where league_id = p_league and player_id = p and team_id = t)) then
    raise exception 'One of the players you''re giving isn''t yours.';
  end if;
  if exists (select 1 from unnest(p_get) p where not exists (select 1 from roster where league_id = p_league and player_id = p and team_id = p_to)) then
    raise exception 'One of the players you asked for isn''t on their team.';
  end if;
  insert into trades (league_id, from_team, to_team, give, get, note) values (p_league, t, p_to, p_give, p_get, nullif(trim(p_note), ''))
  returning trades.id into id;
  return id;
end $$;

-- Moves the players. Fails (status 'failed') if a player moved or a roster would overflow.
create or replace function execute_trade(p_trade uuid) returns void
language plpgsql as $$
declare
  tr trades;
  st jsonb;
  p text;
  pos text;
begin
  select * into tr from trades where id = p_trade for update;
  st := (select settings from leagues where id = tr.league_id);
  if exists (select 1 from unnest(tr.give) g where not exists (select 1 from roster where league_id = tr.league_id and player_id = g and team_id = tr.from_team))
     or exists (select 1 from unnest(tr.get) g where not exists (select 1 from roster where league_id = tr.league_id and player_id = g and team_id = tr.to_team)) then
    update trades set status = 'failed', note = coalesce(note || ' · ', '') || 'A player changed teams first', updated_at = now() where id = p_trade;
    return;
  end if;
  -- Traded players arrive on the bench; IR players come off IR.
  foreach p in array tr.give loop
    pos := (select position from roster where league_id = tr.league_id and player_id = p);
    insert into lineup_log (league_id, team_id, player_id, slot) values (tr.league_id, tr.from_team, p, null);
    perform put_player(tr.league_id, tr.to_team, p, pos, 'BN');
    insert into transactions (league_id, team_id, kind, player_id) values (tr.league_id, tr.to_team, 'trade-in', p);
  end loop;
  foreach p in array tr.get loop
    pos := (select position from roster where league_id = tr.league_id and player_id = p);
    insert into lineup_log (league_id, team_id, player_id, slot) values (tr.league_id, tr.to_team, p, null);
    perform put_player(tr.league_id, tr.from_team, p, pos, 'BN');
    insert into transactions (league_id, team_id, kind, player_id) values (tr.league_id, tr.from_team, 'trade-in', p);
  end loop;
  if active_count(tr.league_id, tr.from_team) > roster_size(st) or active_count(tr.league_id, tr.to_team) > roster_size(st) then
    raise exception 'That trade would leave a roster over the limit — drop someone first.';
  end if;
  update trades set status = 'completed', updated_at = now() where id = p_trade;
  -- Other offers involving these players can't happen any more.
  update trades set status = 'failed', note = coalesce(note || ' · ', '') || 'A player was traded elsewhere', updated_at = now()
  where league_id = tr.league_id and id <> p_trade and status in ('proposed', 'accepted')
    and (give && (tr.give || tr.get) or get && (tr.give || tr.get));
end $$;

create or replace function respond_trade(p_trade uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr trades;
  st jsonb;
begin
  select * into tr from trades where id = p_trade for update;
  if tr.to_team is distinct from my_team(tr.league_id) then raise exception 'That offer isn''t to you.'; end if;
  if tr.status <> 'proposed' then raise exception 'That offer is no longer open.'; end if;
  if not p_accept then
    update trades set status = 'rejected', updated_at = now() where id = p_trade;
    return;
  end if;
  st := (select settings from leagues where id = tr.league_id);
  if coalesce(st -> 'trades' ->> 'review', 'commissioner') = 'none' then
    perform execute_trade(p_trade);
  else
    update trades set status = 'accepted', updated_at = now(),
      review_until = now() + make_interval(hours => coalesce((st -> 'trades' ->> 'reviewHours')::int, 24))
    where id = p_trade;
  end if;
end $$;

create or replace function cancel_trade(p_trade uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update trades set status = 'cancelled', updated_at = now()
  where id = p_trade and status = 'proposed' and from_team = my_team(league_id);
  if not found then raise exception 'Only an open offer you made can be cancelled.'; end if;
end $$;

-- Commissioner: push a trade through now, or veto it.
create or replace function review_trade(p_trade uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr trades;
begin
  select * into tr from trades where id = p_trade for update;
  if (select commissioner from leagues where id = tr.league_id) is distinct from auth.uid() then
    raise exception 'Only the commissioner can review trades.';
  end if;
  if tr.status <> 'accepted' then raise exception 'That trade isn''t waiting for review.'; end if;
  if p_approve then
    perform execute_trade(p_trade);
  else
    update trades set status = 'vetoed', updated_at = now() where id = p_trade;
  end if;
end $$;

-- League vote: teams not in the trade can vote it down during review.
create or replace function veto_vote(p_trade uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tr trades;
  me uuid;
  need int;
begin
  select * into tr from trades where id = p_trade for update;
  me := my_team(tr.league_id);
  if me is null or me in (tr.from_team, tr.to_team) then raise exception 'Only teams not in the trade can vote.'; end if;
  if tr.status <> 'accepted' then raise exception 'That trade isn''t up for review.'; end if;
  insert into trade_votes values (p_trade, me) on conflict do nothing;
  need := coalesce(((select settings from leagues where id = tr.league_id) -> 'trades' ->> 'vetoVotes')::int, 4);
  if (select count(*) from trade_votes where trade_id = p_trade) >= need then
    update trades set status = 'vetoed', updated_at = now() where id = p_trade;
  end if;
end $$;

-- Trades whose review time is up go through. Anyone can call it.
create or replace function process_trades(p_league uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  t record;
  n int := 0;
begin
  if not is_member(p_league) then raise exception 'You are not in this league.'; end if;
  for t in select id from trades where league_id = p_league and status = 'accepted' and review_until <= now() order by review_until loop
    begin
      perform execute_trade(t.id);
    exception when others then
      update trades set status = 'failed', note = sqlerrm, updated_at = now() where id = t.id;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── Results and housekeeping ─────────────────────────────────────────────

-- A finished week's points (and stat line), worked out on a phone from the
-- public stat feeds. First one in wins.
-- p_scores: {"<team id>": {"points": 98.4, "line": {...}}} (a bare number is accepted too).
create or replace function record_week(p_league uuid, p_week int, p_scores jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_league) then raise exception 'You are not in this league.'; end if;
  insert into week_scores (league_id, week, team_id, points, line)
  select p_league, p_week, (key)::uuid,
    case when jsonb_typeof(value) = 'number' then value::text::numeric else (value ->> 'points')::numeric end,
    case when jsonb_typeof(value) = 'object' then coalesce(value -> 'line', '{}') else '{}' end
  from jsonb_each(p_scores)
  where (key)::uuid in (select id from teams where league_id = p_league)
  on conflict do nothing;
end $$;

create or replace function rename_team(p_league uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update teams set name = p_name where league_id = p_league and owner = auth.uid();
end $$;

create or replace function leave_league(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select status from leagues where id = p_league) <> 'setup' then
    raise exception 'You can only leave before the draft.';
  end if;
  if (select commissioner from leagues where id = p_league) = auth.uid() then
    delete from leagues where id = p_league; -- the commissioner leaving ends the league
  else
    delete from teams where league_id = p_league and owner = auth.uid();
  end if;
end $$;

-- The old name, for phones on an older app version.
create or replace function snake_team(draft_order uuid[], pick_no int) returns uuid
language sql immutable as $$ select draft_team(draft_order, pick_no, 'snake') $$;

do $$
declare f text;
begin
  foreach f in array array['create_league', 'update_league', 'join_league', 'start_draft', 'make_pick', 'set_lineup', 'set_slot', 'add_drop',
    'place_claim', 'cancel_claim', 'process_waivers', 'propose_trade', 'respond_trade', 'cancel_trade', 'review_trade', 'veto_vote',
    'process_trades', 'record_week', 'rename_team', 'leave_league'] loop
    execute format('revoke all on function %I from public, anon', f);
    execute format('grant execute on function %I to authenticated', f);
  end loop;
  -- Internal helpers: only callable from the functions above.
  foreach f in array array['put_player', 'check_lineup', 'drop_to_waivers', 'execute_trade'] loop
    execute format('revoke all on function %I from public, anon, authenticated', f);
  end loop;
end $$;
