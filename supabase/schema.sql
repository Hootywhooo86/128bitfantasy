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

-- ── Who can read what ────────────────────────────────────────────────────

create or replace function is_member(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where league_id = l and owner = auth.uid());
$$;

alter table leagues enable row level security;
alter table teams enable row level security;
alter table picks enable row level security;
alter table roster enable row level security;
alter table lineup_log enable row level security;
alter table matchups enable row level security;
alter table week_scores enable row level security;

-- Supabase grants these by default; spelled out so a fresh project matches.
grant usage on schema public to authenticated;
grant select on leagues, teams, picks, roster, lineup_log, matchups, week_scores to authenticated;

drop policy if exists "members read" on leagues;
create policy "members read" on leagues for select using (is_member(id));
drop policy if exists "members read" on teams;
create policy "members read" on teams for select using (is_member(league_id));
drop policy if exists "members read" on picks;
create policy "members read" on picks for select using (is_member(league_id));
drop policy if exists "members read" on roster;
create policy "members read" on roster for select using (is_member(league_id));
drop policy if exists "members read" on lineup_log;
create policy "members read" on lineup_log for select using (is_member(league_id));
drop policy if exists "members read" on matchups;
create policy "members read" on matchups for select using (is_member(league_id));
drop policy if exists "members read" on week_scores;
create policy "members read" on week_scores for select using (is_member(league_id));

-- Live draft boards: phones get new picks the moment they're made.
do $$ begin
  alter publication supabase_realtime add table picks;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table leagues;
exception when others then null; end $$;

-- ── Helpers ──────────────────────────────────────────────────────────────

create or replace function my_team(l uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from teams where league_id = l and owner = auth.uid();
$$;

create or replace function roster_size(settings jsonb) returns int
language sql immutable as $$
  select coalesce((select sum(value::int) from jsonb_each_text(settings -> 'slots')), 0)
       + coalesce((settings ->> 'bench')::int, 0);
$$;

-- The team on the clock for a pick, snaking every round. Matches draft.ts.
create or replace function snake_team(draft_order uuid[], pick_no int) returns uuid
language sql immutable as $$
  select case when (pick_no / array_length(draft_order, 1)) % 2 = 0
    then draft_order[(pick_no % array_length(draft_order, 1)) + 1]
    else draft_order[array_length(draft_order, 1) - (pick_no % array_length(draft_order, 1))]
  end;
$$;

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
  on_clock := snake_team(lg.draft_order, n);
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
  insert into roster (league_id, team_id, player_id, position, slot) values (p_league, on_clock, p_player, p_position, p_slot);
  insert into lineup_log (league_id, team_id, player_id, slot) values (p_league, on_clock, p_player, p_slot);
  update leagues set last_pick_at = now(),
    status = case when n + 1 >= array_length(draft_order, 1) * roster_size(settings) then 'season' else status end
  where id = p_league;
end $$;

-- Move one of your players to another slot (or BN / IR).
create or replace function set_slot(p_league uuid, p_player text, p_slot text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t uuid := my_team(p_league);
begin
  if t is null then raise exception 'You are not in this league.'; end if;
  update roster set slot = p_slot where league_id = p_league and player_id = p_player and team_id = t;
  if not found then raise exception 'That player is not on your team.'; end if;
  insert into lineup_log (league_id, team_id, player_id, slot) values (p_league, t, p_player, p_slot);
end $$;

-- Free-agent pickup, optionally dropping someone to make room.
create or replace function add_drop(p_league uuid, p_add text, p_add_position text, p_drop text)
returns void language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  t uuid := my_team(p_league);
begin
  select * into lg from leagues where id = p_league for update;
  if t is null then raise exception 'You are not in this league.'; end if;
  if lg.status <> 'season' then raise exception 'Pickups open after the draft.'; end if;
  if p_drop is not null then
    delete from roster where league_id = p_league and player_id = p_drop and team_id = t;
    if not found then raise exception 'That player is not on your team.'; end if;
    insert into lineup_log (league_id, team_id, player_id, slot) values (p_league, t, p_drop, null);
  end if;
  if p_add is not null then
    if exists (select 1 from roster where league_id = p_league and player_id = p_add) then
      raise exception 'Someone already has that player.';
    end if;
    if (select count(*) from roster where league_id = p_league and team_id = t) >= roster_size(lg.settings) then
      raise exception 'Your roster is full — drop someone.';
    end if;
    insert into roster (league_id, team_id, player_id, position, slot) values (p_league, t, p_add, p_add_position, 'BN');
    insert into lineup_log (league_id, team_id, player_id, slot) values (p_league, t, p_add, 'BN');
  end if;
end $$;

-- A finished week's points, worked out on a phone from the public stat
-- feeds. First one in wins; the week must be over.
create or replace function record_week(p_league uuid, p_week int, p_scores jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_league) then raise exception 'You are not in this league.'; end if;
  insert into week_scores (league_id, week, team_id, points)
  select p_league, p_week, (key)::uuid, (value)::numeric from jsonb_each_text(p_scores)
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

revoke all on function create_league, join_league, start_draft, make_pick, set_slot, add_drop, record_week, rename_team, leave_league from anon;
grant execute on function create_league, join_league, start_draft, make_pick, set_slot, add_drop, record_week, rename_team, leave_league to authenticated;
