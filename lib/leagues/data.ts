/**
 * Reads and writes for 128BIT LEAGUES. Every write is one of the database
 * functions in supabase/schema.sql, which check turn / team / commissioner
 * on the server; this file only shapes rows and calls them.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { autoPick, draftState, rankPool, shuffleOrder, slotTakes } from '@/src/leagues/draft';
import type { HostedSport } from '@/src/leagues/scoring';
import { roundRobin, type LineupMove } from '@/src/leagues/season';
import { isH2H } from '@/src/leagues/types';
import { defaultSettings, withDefaults } from '@/src/leagues/settings';
import type { StatLine } from '@/src/leagues/scoring';
import {
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
  settings: withDefaults(r.sport as HostedSport, r.settings as Partial<LeagueSettings>),
  draftOrder: (r.draft_order as string[] | null) ?? [],
  createdAt: String(r.created_at),
  seasonStart: (r.season_start as string | null) ?? null,
  lastPickAt: (r.last_pick_at as string | null) ?? null,
});

export type LeagueRow = ReturnType<typeof toLeague>;

export type TeamRow = HostedTeam & { waiverRank: number | null; faab: number };

export type Claim = { id: string; playerId: string; position: string; dropPlayer: string | null; bid: number; status: string; note: string | null; createdAt: string };

export type Trade = {
  id: string;
  fromTeam: string;
  toTeam: string;
  give: string[];
  get: string[];
  note: string | null;
  status: 'proposed' | 'accepted' | 'completed' | 'rejected' | 'cancelled' | 'vetoed' | 'failed';
  reviewUntil: string | null;
  createdAt: string;
  votes: string[];
};

export type Activity = { id: number; teamId: string | null; kind: string; playerId: string | null; detail: string | null; at: string };

export type LeagueBundle = {
  league: LeagueRow;
  teams: TeamRow[];
  /** Players on waivers → when they clear. */
  waivers: Map<string, string>;
  myClaims: Claim[];
  trades: Trade[];
  activity: Activity[];
  picks: DraftPick[];
  roster: (RosterEntry & { position: string })[];
  matchups: HostedMatchup[];
  log: LineupMove[];
  weekScores: { week: number; teamId: string; points: number; line: StatLine }[];
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
  const [lg, teams, picks, roster, matchups, log, weeks, waivers, claims, trades, votes, activity] = await Promise.all([
    sb.from('leagues').select('*').eq('id', id).single(),
    sb.from('teams').select('*').eq('league_id', id),
    sb.from('picks').select('*').eq('league_id', id).order('pick_no'),
    sb.from('roster').select('*').eq('league_id', id),
    sb.from('matchups').select('*').eq('league_id', id).order('week'),
    sb.from('lineup_log').select('*').eq('league_id', id).order('id'),
    sb.from('week_scores').select('*').eq('league_id', id),
    // Tables added after the first release: an old database just has none of them.
    sb.from('waivers').select('*').eq('league_id', id),
    sb.from('claims').select('*').eq('league_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('trades').select('*').eq('league_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('trade_votes').select('*'),
    sb.from('transactions').select('*').eq('league_id', id).order('at', { ascending: false }).limit(60),
  ]);
  const opt = <T,>(res: { data: T | null; error: unknown }): T | [] => (res.error ? [] : (res.data ?? []));
  const voteRows = opt(votes) as Row[];
  const league = toLeague(must(lg) as Row);
  const teamRows = (must(teams) ?? []) as Row[];
  const t: TeamRow[] = teamRows.map((r) => ({
    id: String(r.id),
    leagueId: id,
    owner: String(r.owner),
    name: String(r.name),
    waiverRank: r.waiver_rank == null ? null : Number(r.waiver_rank),
    faab: Number(r.faab ?? 0),
  }));
  return {
    league,
    teams: t,
    waivers: new Map((opt(waivers) as Row[]).filter((r) => Date.parse(String(r.until)) > Date.now()).map((r) => [String(r.player_id), String(r.until)])),
    myClaims: (opt(claims) as Row[]).map((r) => ({
      id: String(r.id),
      playerId: String(r.player_id),
      position: String(r.position),
      dropPlayer: (r.drop_player as string | null) ?? null,
      bid: Number(r.bid ?? 0),
      status: String(r.status),
      note: (r.note as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
    trades: (opt(trades) as Row[]).map((r) => ({
      id: String(r.id),
      fromTeam: String(r.from_team),
      toTeam: String(r.to_team),
      give: (r.give as string[]) ?? [],
      get: (r.get as string[]) ?? [],
      note: (r.note as string | null) ?? null,
      status: r.status as Trade['status'],
      reviewUntil: (r.review_until as string | null) ?? null,
      createdAt: String(r.created_at),
      votes: voteRows.filter((v) => v.trade_id === r.id).map((v) => String(v.team_id)),
    })),
    activity: (opt(activity) as Row[]).map((r) => ({
      id: Number(r.id),
      teamId: (r.team_id as string | null) ?? null,
      kind: String(r.kind),
      playerId: (r.player_id as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
      at: String(r.at),
    })),
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
    weekScores: ((must(weeks) ?? []) as Row[]).map((r) => ({
      week: Number(r.week),
      teamId: String(r.team_id),
      points: Number(r.points),
      line: (r.line as StatLine | null) ?? {},
    })),
    me,
    myTeamId: t.find((x) => x.owner === me)?.id ?? null,
  };
}


export async function createLeague(input: {
  name: string;
  sport: HostedSport;
  season: string;
  maxTeams: number;
  teamName: string;
  settings?: LeagueSettings;
}): Promise<string> {
  const sb = await hosted();
  return String(
    must(
      await sb.rpc('create_league', {
        p_name: input.name.trim(),
        p_sport: input.sport,
        p_season: input.season,
        p_max_teams: input.maxTeams,
        p_settings: input.settings ?? defaultSettings(input.sport),
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
  // Season-long formats (total points, roto) have no matchups.
  const schedule = isH2H(b.league.settings.format)
    ? roundRobin(order, b.league.settings.weeks).map((m) => ({ week: m.week, home: m.home, away: m.away ?? '' }))
    : [];
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

/** Several moves checked together — a swap between two full slots needs this. */
export async function setLineup(leagueId: string, moves: { player: string; slot: string }[]): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('set_lineup', { p_league: leagueId, p_moves: moves }));
}

export async function updateLeague(leagueId: string, name: string, maxTeams: number, settings: LeagueSettings): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('update_league', { p_league: leagueId, p_name: name, p_max_teams: maxTeams, p_settings: settings }));
}

export async function placeClaim(leagueId: string, add: PoolPlayer, dropId: string | null, bid: number): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('place_claim', { p_league: leagueId, p_player: add.id, p_position: add.position, p_drop: dropId, p_bid: bid }));
}

export async function cancelClaim(claimId: string): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('cancel_claim', { p_claim: claimId }));
}

/**
 * Runs anything that's due: waivers that have cleared, trades whose review
 * time is up. Called when someone opens the league; harmless to repeat.
 */
export async function processDue(leagueId: string): Promise<void> {
  const sb = await hosted();
  await Promise.all([sb.rpc('process_waivers', { p_league: leagueId }), sb.rpc('process_trades', { p_league: leagueId })]);
}

export async function proposeTrade(leagueId: string, toTeam: string, give: string[], get: string[], note: string): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('propose_trade', { p_league: leagueId, p_to: toTeam, p_give: give, p_get: get, p_note: note }));
}

export async function respondTrade(tradeId: string, accept: boolean): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('respond_trade', { p_trade: tradeId, p_accept: accept }));
}

export async function cancelTrade(tradeId: string): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('cancel_trade', { p_trade: tradeId }));
}

export async function reviewTrade(tradeId: string, approve: boolean): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('review_trade', { p_trade: tradeId, p_approve: approve }));
}

export async function vetoVote(tradeId: string): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('veto_vote', { p_trade: tradeId }));
}

export async function addDrop(leagueId: string, add: PoolPlayer | null, dropId: string | null): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('add_drop', { p_league: leagueId, p_add: add?.id ?? null, p_add_position: add?.position ?? null, p_drop: dropId }));
}

export async function recordWeek(leagueId: string, week: number, scores: Record<string, { points: number; line: StatLine }>): Promise<void> {
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

export { defaultSettings };
