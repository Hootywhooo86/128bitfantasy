/**
 * Standings and playoffs for every league format, from recorded weeks.
 *
 * Every team's week is recorded (points + summed stat line) whether or not
 * the format has matchups, so the same rows serve head-to-head, total
 * points and roto, and playoff brackets can be worked out from them on any
 * phone without storing the bracket.
 */
import { categoryDefs, h2hCats, rotoPoints, type CategoryDef } from './categories';
import { addLines, type HostedSport, type StatLine } from './scoring';
import { isH2H, type HostedMatchup, type LeagueFormat, type LeagueSettings } from './types';

export type WeekRow = { week: number; teamId: string; points: number; line: StatLine };

export type TableRow = {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Roto points, or category wins in category formats; null otherwise. */
  score: number | null;
  rank: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function rowsBy(rows: WeekRow[]): Map<string, WeekRow> {
  return new Map(rows.map((r) => [`${r.week}:${r.teamId}`, r]));
}

export type Outcome = { aWins: boolean; bWins: boolean; a: number; b: number; catWins?: [number, number, number] };

/** Who won a week between two teams, in this format. `a`/`b` are what the scoreboard shows. */
export function weekOutcome(format: LeagueFormat, defs: CategoryDef[], ra: WeekRow, rb: WeekRow): Outcome {
  if (format === 'h2h_cats' || format === 'h2h_most_cats') {
    const m = h2hCats(defs, ra.line, rb.line);
    return { aWins: m.wins > m.losses, bWins: m.losses > m.wins, a: m.wins, b: m.losses, catWins: [m.wins, m.losses, m.ties] };
  }
  return { aWins: ra.points > rb.points, bWins: rb.points > ra.points, a: ra.points, b: rb.points };
}

export function leagueTable(
  sport: HostedSport,
  s: Pick<LeagueSettings, 'format' | 'categories' | 'weeks'>,
  teamIds: string[],
  matchups: HostedMatchup[],
  weeks: WeekRow[]
): TableRow[] {
  const defs = categoryDefs(sport, s.categories);
  const regular = weeks.filter((w) => w.week <= s.weeks);
  const t = new Map<string, TableRow>(
    teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, score: null, rank: 0 }])
  );
  for (const w of regular) {
    const row = t.get(w.teamId);
    if (row) row.pointsFor += w.points;
  }

  if (isH2H(s.format)) {
    const by = rowsBy(regular);
    for (const m of matchups) {
      if (m.week > s.weeks || !m.away) continue;
      const ra = by.get(`${m.week}:${m.home}`);
      const rb = by.get(`${m.week}:${m.away}`);
      const a = t.get(m.home);
      const b = t.get(m.away);
      if (!ra || !rb || !a || !b) continue;
      a.pointsAgainst += rb.points;
      b.pointsAgainst += ra.points;
      const o = weekOutcome(s.format, defs, ra, rb);
      if (s.format === 'h2h_cats' && o.catWins) {
        // Every category is its own W/L/T, Yahoo style.
        const [w, l, tie] = o.catWins;
        a.wins += w;
        a.losses += l;
        a.ties += tie;
        b.wins += l;
        b.losses += w;
        b.ties += tie;
        a.score = (a.score ?? 0) + w;
        b.score = (b.score ?? 0) + l;
      } else if (o.aWins) {
        a.wins++;
        b.losses++;
      } else if (o.bWins) {
        b.wins++;
        a.losses++;
      } else {
        a.ties++;
        b.ties++;
      }
    }
  }

  if (s.format === 'roto') {
    const totals = new Map<string, StatLine>(teamIds.map((id) => [id, {}]));
    for (const w of regular) if (totals.has(w.teamId)) totals.set(w.teamId, addLines(totals.get(w.teamId)!, w.line));
    for (const [id, r] of rotoPoints(defs, totals)) t.get(id)!.score = r.total;
  }

  const pct = (r: TableRow) => {
    const g = r.wins + r.losses + r.ties;
    return g ? (r.wins + r.ties / 2) / g : 0;
  };
  const sorted = [...t.values()]
    .map((r) => ({ ...r, pointsFor: r2(r.pointsFor), pointsAgainst: r2(r.pointsAgainst) }))
    .sort((a, b) => {
      if (s.format === 'roto') return (b.score ?? 0) - (a.score ?? 0) || b.pointsFor - a.pointsFor;
      if (s.format === 'points') return b.pointsFor - a.pointsFor;
      return pct(b) - pct(a) || b.pointsFor - a.pointsFor;
    });
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Playoff seeds: with divisions, each division's best team first (in
 * standings order), then everyone else by standings.
 */
export function playoffSeeds(table: TableRow[], n: number, divisionOf?: Map<string, number | null | undefined>): string[] {
  const order = table.map((r) => r.teamId);
  if (!divisionOf || ![...divisionOf.values()].some((d) => d != null)) return order.slice(0, n);
  const winners: string[] = [];
  const seen = new Set<number>();
  for (const t of order) {
    const d = divisionOf.get(t);
    if (d != null && !seen.has(d)) {
      seen.add(d);
      winners.push(t);
    }
  }
  const top = winners.slice(0, n);
  return [...top, ...order.filter((t) => !top.includes(t))].slice(0, n);
}

export function playoffRounds(teams: number): number {
  return teams >= 2 ? Math.ceil(Math.log2(teams)) : 0;
}

/**
 * The playoff pairs for one round (1-based), played in week `weeks + round`.
 * Seeds 1..N, bracket padded to a power of two with byes for the top seeds
 * (1 vs 8, 4 vs 5, 3 vs 6, 2 vs 7). Later rounds pair the winners in bracket
 * order; a tied week goes to the higher seed.
 */
export function playoffPairs(
  seeds: string[],
  round: number,
  winner: (week: number, a: string, b: string) => string | null,
  regularWeeks: number
): [string, string | null][] {
  const n = seeds.length;
  if (n < 2) return [];
  const size = 2 ** playoffRounds(n);
  // Standard bracket order: [1, 8, 4, 5, 2, 7, 3, 6] for 8.
  let order = [1];
  while (order.length < size) order = order.flatMap((x) => [x, order.length * 2 + 1 - x]);
  let pairs: [string | null, string | null][] = [];
  for (let i = 0; i < size; i += 2) pairs.push([seeds[order[i] - 1] ?? null, seeds[order[i + 1] - 1] ?? null]);
  const seedOf = (t: string) => seeds.indexOf(t);
  for (let r = 1; r < round; r++) {
    const week = regularWeeks + r;
    const winners = pairs.map(([a, b]) => {
      if (!a || !b) return a ?? b;
      const w = winner(week, a, b);
      if (w) return w;
      return null;
    });
    if (winners.some((w) => w == null)) return [];
    const next: [string | null, string | null][] = [];
    for (let i = 0; i < winners.length; i += 2) next.push([winners[i], winners[i + 1]]);
    pairs = next;
  }
  return pairs
    .filter(([a, b]) => a || b)
    .map(([a, b]) => {
      const x = (a ?? b)!;
      const y = a && b ? b : null;
      // Higher seed listed first (home).
      return y && seedOf(y) < seedOf(x) ? [y, x] : [x, y];
    });
}

/** The week's winner between two playoff teams, ties to the higher seed; null if not recorded yet. */
export function playoffWinner(
  sport: HostedSport,
  s: Pick<LeagueSettings, 'format' | 'categories'>,
  weeks: WeekRow[],
  seeds: string[]
): (week: number, a: string, b: string) => string | null {
  const by = rowsBy(weeks);
  const defs = categoryDefs(sport, s.categories);
  return (week, a, b) => {
    const ra = by.get(`${week}:${a}`);
    const rb = by.get(`${week}:${b}`);
    if (!ra || !rb) return null;
    const o = weekOutcome(s.format, defs, ra, rb);
    if (o.aWins) return a;
    if (o.bWins) return b;
    return seeds.indexOf(a) <= seeds.indexOf(b) ? a : b;
  };
}

/** Matchups for any week: the schedule in the regular season, the bracket after. */
export function matchupsForWeek(
  sport: HostedSport,
  s: Pick<LeagueSettings, 'format' | 'categories' | 'weeks' | 'playoffTeams'>,
  teamIds: string[],
  schedule: HostedMatchup[],
  weeks: WeekRow[],
  week: number,
  leagueId = '',
  divisionOf?: Map<string, number | null | undefined>
): HostedMatchup[] {
  if (!isH2H(s.format)) return [];
  if (week <= s.weeks) return schedule.filter((m) => m.week === week);
  const round = week - s.weeks;
  const n = Math.min(s.playoffTeams, teamIds.length);
  if (n < 2 || round > playoffRounds(n)) return [];
  // Seeds only exist once every regular week is in.
  const recorded = new Set(weeks.map((w) => w.week));
  for (let w = 1; w <= s.weeks; w++) if (!recorded.has(w)) return [];
  const seeds = playoffSeeds(leagueTable(sport, s, teamIds, schedule, weeks), n, divisionOf);
  return playoffPairs(seeds, round, playoffWinner(sport, s, weeks, seeds), s.weeks).map(([home, away]) => ({ leagueId, week, home, away }));
}

/** The champion once the final is recorded. */
export function champion(
  sport: HostedSport,
  s: Pick<LeagueSettings, 'format' | 'categories' | 'weeks' | 'playoffTeams'>,
  teamIds: string[],
  schedule: HostedMatchup[],
  weeks: WeekRow[],
  divisionOf?: Map<string, number | null | undefined>
): string | null {
  if (!isH2H(s.format) || s.playoffTeams < 2) {
    const last = s.weeks;
    if (!weeks.some((w) => w.week === last)) return null;
    return leagueTable(sport, s, teamIds, schedule, weeks)[0]?.teamId ?? null;
  }
  const n = Math.min(s.playoffTeams, teamIds.length);
  const rounds = playoffRounds(n);
  const finalWeek = s.weeks + rounds;
  const [fin] = matchupsForWeek(sport, s, teamIds, schedule, weeks, finalWeek, '', divisionOf);
  if (!fin) return null;
  if (!fin.away) return fin.home;
  const seeds = playoffSeeds(leagueTable(sport, s, teamIds, schedule, weeks), n, divisionOf);
  return playoffWinner(sport, s, weeks, seeds)(finalWeek, fin.home, fin.away);
}
