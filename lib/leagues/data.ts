/**
 * Reads and writes for 128BIT LEAGUES. Every write is one of the database
 * functions in supabase/schema.sql, which check turn / team / commissioner
 * on the server; this file only shapes rows and calls them.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { autoPick, draftState, rankPool, shuffleOrder, slotTakes } from '@/src/leagues/draft';
import { DEFAULT_SCORING, type HostedSport } from '@/src/leagues/scoring';
import { roundRobin, type LineupMove } from '@/src/leagues/season';
import {
  DEFAULT_BENCH,
  DEFAULT_SLOTS,
  type DraftPick,
  type HostedLeague,
  type HostedMatchup,
  type HostedTeam,
  type LeagueSettings,
  type PoolPlayer,
  type RosterEntry,
} from '@/src/leagues/types';
import { hosted, must } from './client';

type Row = Record<string, unknown>;

const toLeague = (r: Row): HostedLeague & { seasonStart: string | null; lastPickAt: string | null } => ({
  id: String(r.id),
  name: String(r.name),
  sport: r.sport as HostedSport,
  season: String(r.season),
  inviteCode: String(r.invite_code),
  commissioner: String(r.commissioner),
  maxTeams: Number(r.max_teams),
  status: r.status as HostedLeague['status'],
  settings: r.settings as LeagueSettings,
  draftOrder: (r.draft_order as string[] | null) ?? [],
  createdAt: String(r.created_at),
  seasonStart: (r.season_start as string | null) ?? null,
  lastPickAt: (r.last_pick_at as string | null) ?? null,
});

export type LeagueRow = ReturnType<typeof toLeague>;

export type LeagueBundle = {
  league: LeagueRow;
  teams: HostedTeam[];
  picks: DraftPick[];
  roster: (RosterEntry & { position: string })[];
  matchups: HostedMatchup[];
  log: LineupMove[];
  weekScores: { week: number; teamId: string; points: number }[];
  me: string | null;
  myTeamId: string | null;
};

export async function myHostedLeagues(): Promise<LeagueRow[]> {
  const sb = await hosted();
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return [];
  // Row-level security already limits this to leagues you're in.
  const rows = must(await sb.from('leagues').select('*').order('created_at', { ascending: false }));
  return (rows ?? []).map(toLeague);
}

export async function leagueBundle(id: string): Promise<LeagueBundle> {
  const sb = await hosted();
  const { data: s } = await sb.auth.getSession();
  const me = s.session?.user.id ?? null;
  const [lg, teams, picks, roster, matchups, log, weeks] = await Promise.all([
    sb.from('leagues').select('*').eq('id', id).single(),
    sb.from('teams').select('*').eq('league_id', id),
    sb.from('picks').select('*').eq('league_id', id).order('pick_no'),
    sb.from('roster').select('*').eq('league_id', id),
    sb.from('matchups').select('*').eq('league_id', id).order('week'),
    sb.from('lineup_log').select('*').eq('league_id', id).order('id'),
    sb.from('week_scores').select('*').eq('league_id', id),
  ]);
  const league = toLeague(must(lg) as Row);
  const teamRows = (must(teams) ?? []) as Row[];
  const t = teamRows.map((r) => ({ id: String(r.id), leagueId: id, owner: String(r.owner), name: String(r.name) }));
  return {
    league,
    teams: t,
    picks: ((must(picks) ?? []) as Row[]).map((r) => ({
      leagueId: id,
      pickNo: Number(r.pick_no),
      teamId: String(r.team_id),
      playerId: String(r.player_id),
      madeAt: String(r.made_at),
      auto: !!r.auto,
    })),
    roster: ((must(roster) ?? []) as Row[]).map((r) => ({
      leagueId: id,
      teamId: String(r.team_id),
      playerId: String(r.player_id),
      position: String(r.position),
      slot: String(r.slot),
    })),
    matchups: ((must(matchups) ?? []) as Row[]).map((r) => ({
      leagueId: id,
      week: Number(r.week),
      home: String(r.home),
      away: r.away ? String(r.away) : null,
    })),
    log: ((must(log) ?? []) as Row[]).map((r) => ({
      teamId: String(r.team_id),
      playerId: String(r.player_id),
      slot: (r.slot as string | null) ?? null,
      at: String(r.at),
    })),
    weekScores: ((must(weeks) ?? []) as Row[]).map((r) => ({ week: Number(r.week), teamId: String(r.team_id), points: Number(r.points) })),
    me,
    myTeamId: t.find((x) => x.owner === me)?.id ?? null,
  };
}

export function defaultSettings(sport: HostedSport): LeagueSettings {
  return {
    slots: DEFAULT_SLOTS[sport],
    bench: DEFAULT_BENCH[sport],
    scoring: DEFAULT_SCORING[sport],
    pickSeconds: 90,
    // NHL regular season is ~25 weeks; NFL fantasy regular season is 14.
    weeks: sport === 'nhl' ? 23 : 14,
  };
}

export async function createLeague(input: { name: string; sport: HostedSport; season: string; maxTeams: number; teamName: string }): Promise<string> {
  const sb = await hosted();
  return String(
    must(
      await sb.rpc('create_league', {
        p_name: input.name.trim(),
        p_sport: input.sport,
        p_season: input.season,
        p_max_teams: input.maxTeams,
        p_settings: defaultSettings(input.sport),
        p_team_name: input.teamName.trim(),
      })
    )
  );
}

export async function joinLeague(code: string, teamName: string): Promise<string> {
  const sb = await hosted();
  return String(must(await sb.rpc('join_league', { p_code: code.trim(), p_team_name: teamName.trim() })));
}

/** Commissioner: random draft order, full schedule, go. */
export async function startDraft(b: LeagueBundle, seasonStart: string): Promise<void> {
  const sb = await hosted();
  const order = shuffleOrder(b.teams.map((t) => t.id));
  const schedule = roundRobin(order, b.league.settings.weeks).map((m) => ({ week: m.week, home: m.home, away: m.away ?? '' }));
  must(await sb.rpc('start_draft', { p_league: b.league.id, p_order: order, p_schedule: schedule, p_season_start: seasonStart }));
}

/** The slot a new pick lands in: an open starting slot it fits, else the bench. */
export function landingSlot(b: LeagueBundle, teamId: string, position: string): string {
  const s = b.league.settings;
  const used: Record<string, number> = {};
  for (const r of b.roster) if (r.teamId === teamId) used[r.slot] = (used[r.slot] ?? 0) + 1;
  const exact = Object.keys(s.slots).filter((k) => k === position);
  const flex = Object.keys(s.slots).filter((k) => k !== position && slotTakes(k, position));
  for (const slot of [...exact, ...flex]) if ((used[slot] ?? 0) < s.slots[slot]) return slot;
  return 'BN';
}

export async function draftPlayer(b: LeagueBundle, p: PoolPlayer, forTeam?: string): Promise<void> {
  const sb = await hosted();
  const team = forTeam ?? b.myTeamId ?? '';
  must(await sb.rpc('make_pick', { p_league: b.league.id, p_player: p.id, p_position: p.position, p_slot: landingSlot(b, team, p.position) }));
}

/** Picks for the team on the clock when its time is up (the server checks the clock). */
export async function autoDraft(b: LeagueBundle, pool: PoolPlayer[]): Promise<PoolPlayer | null> {
  const st = draftState(b.league.draftOrder, b.league.settings, b.picks);
  if (!st.onClock || !st.round) return null;
  const byId = new Map(pool.map((p) => [p.id, p]));
  const mine = b.roster.filter((r) => r.teamId === st.onClock).map((r) => byId.get(r.playerId)).filter((p): p is PoolPlayer => !!p);
  const pick = autoPick(rankPool(pool, b.league.settings.scoring), st.taken, mine, b.league.settings, st.round);
  if (pick) await draftPlayer(b, pick, st.onClock);
  return pick;
}

export async function setSlot(leagueId: string, playerId: string, slot: string): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('set_slot', { p_league: leagueId, p_player: playerId, p_slot: slot }));
}

export async function addDrop(leagueId: string, add: PoolPlayer | null, dropId: string | null): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('add_drop', { p_league: leagueId, p_add: add?.id ?? null, p_add_position: add?.position ?? null, p_drop: dropId }));
}

export async function recordWeek(leagueId: string, week: number, scores: Record<string, number>): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('record_week', { p_league: leagueId, p_week: week, p_scores: scores }));
}

export async function leaveLeague(leagueId: string): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('leave_league', { p_league: leagueId }));
}

/** Calls back on every new pick or league change, live. Returns the unsubscribe. */
export async function watchLeague(leagueId: string, onChange: () => void): Promise<() => void> {
  const sb = await hosted();
  const ch: RealtimeChannel = sb
    .channel(`league-${leagueId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks', filter: `league_id=eq.${leagueId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leagues', filter: `id=eq.${leagueId}` }, onChange)
    .subscribe();
  return () => {
    sb.removeChannel(ch);
  };
}
