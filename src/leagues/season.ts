/**
 * The season: who plays whom, which slots count when, weekly points and
 * standings.
 *
 * Lineups are judged at puck drop / kickoff. Every move is logged with the
 * server's clock, and a player's points from a game count only if the log
 * has him in a starting slot when that game started. Moving someone in after
 * his game began does nothing, so no lock has to be trusted to the phone.
 */
import { fantasyPoints, type ScoringRules, type StatLine } from './scoring';
import type { HostedMatchup, RosterSlots } from './types';

/**
 * Round robin by the circle method: every team plays every other once, then
 * it repeats. An odd team count gets a bye (away = null).
 */
export function roundRobin(teamIds: string[], weeks: number, leagueId = ''): HostedMatchup[] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.length % 2) teams.push(null);
  const n = teams.length;
  const out: HostedMatchup[] = [];
  let ring = teams.slice(1);
  for (let w = 0; w < weeks; w++) {
    const round = [teams[0], ...ring];
    for (let i = 0; i < n / 2; i++) {
      const a = round[i];
      const b = round[n - 1 - i];
      // Alternate home and away so the fixed team isn't always home.
      const [home, away] = w % 2 ? [b, a] : [a, b];
      if (home == null && away == null) continue;
      if (home == null) out.push({ leagueId, week: w + 1, home: away!, away: null });
      else out.push({ leagueId, week: w + 1, home, away });
    }
    ring = [ring[ring.length - 1], ...ring.slice(0, -1)];
  }
  return out;
}

export type LineupMove = { teamId: string; playerId: string; slot: string | null; at: string };

const BENCH = new Set(['BN', 'IR']);

export function isStarting(slot: string | null | undefined): boolean {
  return !!slot && !BENCH.has(slot);
}

/** Where a team had a player at time `at` (ISO): the latest logged move at or before it. */
export function slotAt(log: LineupMove[], teamId: string, playerId: string, at: string): string | null {
  const t = Date.parse(at);
  let best: LineupMove | null = null;
  for (const m of log) {
    if (m.teamId !== teamId || m.playerId !== playerId) continue;
    const mt = Date.parse(m.at);
    if (mt <= t && (!best || mt >= Date.parse(best.at))) best = m;
  }
  return best?.slot ?? null;
}

/** One player's stats from one game, with when it started. */
export type GameStat = { playerId: string; start: string; line: StatLine };

export type PlayerWeek = { playerId: string; points: number; games: number };

/**
 * A team's points for a week: every game stat whose player was in one of
 * this team's starting slots at that game's start.
 */
export function teamWeek(
  teamId: string,
  log: LineupMove[],
  stats: GameStat[],
  rules: ScoringRules
): { total: number; players: PlayerWeek[] } {
  const by = new Map<string, PlayerWeek>();
  let total = 0;
  for (const g of stats) {
    if (!isStarting(slotAt(log, teamId, g.playerId, g.start))) continue;
    const pts = fantasyPoints(g.line, rules);
    total += pts;
    const pw = by.get(g.playerId) ?? { playerId: g.playerId, points: 0, games: 0 };
    pw.points = Math.round((pw.points + pts) * 100) / 100;
    pw.games += 1;
    by.set(g.playerId, pw);
  }
  return { total: Math.round(total * 100) / 100, players: [...by.values()] };
}

/** Count of each starting slot filled in a lineup, for "too many C" checks. */
export function slotCounts(lineup: { slot: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of lineup) out[e.slot] = (out[e.slot] ?? 0) + 1;
  return out;
}

/** Why a slot can't take another player, or null if it can. */
export function slotFull(slots: RosterSlots, bench: number, lineup: { slot: string; playerId: string }[], slot: string, playerId: string): string | null {
  const others = lineup.filter((e) => e.playerId !== playerId && e.slot === slot).length;
  if (slot === 'IR') return null;
  const cap = slot === 'BN' ? bench : (slots[slot] ?? 0);
  return others >= cap ? `${slot} is full` : null;
}

export type WeekResult = { week: number; home: string; away: string | null; homePts: number; awayPts: number | null };

export type StandingRow = { teamId: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; rank: number };

/** Standings from finished weeks: record first, points for as the tiebreak. */
export function standings(teamIds: string[], results: WeekResult[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, rank: 0 }])
  );
  for (const r of results) {
    const h = rows.get(r.home);
    if (!h) continue;
    h.pointsFor += r.homePts;
    if (r.away == null || r.awayPts == null) continue;
    const a = rows.get(r.away);
    if (!a) continue;
    a.pointsFor += r.awayPts;
    h.pointsAgainst += r.awayPts;
    a.pointsAgainst += r.homePts;
    if (r.homePts > r.awayPts) {
      h.wins++;
      a.losses++;
    } else if (r.homePts < r.awayPts) {
      a.wins++;
      h.losses++;
    } else {
      h.ties++;
      a.ties++;
    }
  }
  const pct = (r: StandingRow) => {
    const g = r.wins + r.losses + r.ties;
    return g ? (r.wins + r.ties / 2) / g : 0;
  };
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, pointsFor: Math.round(r.pointsFor * 100) / 100, pointsAgainst: Math.round(r.pointsAgainst * 100) / 100 }))
    .sort((a, b) => pct(b) - pct(a) || b.pointsFor - a.pointsFor);
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Hockey weeks run Monday to Sunday, turning over at 08:00 UTC (3-4am in
 * New York) so a late Sunday game in the west still belongs to Sunday.
 * Week 1 is the week the season starts in, so a Thursday opener gives a short
 * first week, like Yahoo. Football uses the NFL's own week numbers instead.
 */
export function weekRange(seasonStart: string, week: number): { from: Date; to: Date } {
  const d = new Date(seasonStart);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  monday.setUTCHours(8);
  const from = new Date(monday);
  from.setUTCDate(from.getUTCDate() + (week - 1) * 7);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { from, to };
}

export function weekOf(seasonStart: string, now: Date): number {
  const { from } = weekRange(seasonStart, 1);
  return Math.max(1, Math.floor((now.getTime() - from.getTime()) / (7 * 86400_000)) + 1);
}
