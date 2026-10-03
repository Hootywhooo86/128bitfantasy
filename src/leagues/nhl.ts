/**
 * NHL stats for hosted hockey leagues — the NHL's own free web API, no key.
 *
 * api-web.nhle.com: rosters, schedule, live box scores.
 * api.nhle.com/stats/rest: whole-league season totals in one call each,
 * used to rank players for the draft.
 *
 * Pure parsers here; lib/leagues/nhl-fetch.ts does the requests.
 */
import { num } from '@/src/sports/models';
import type { StatLine } from './scoring';
import type { PoolPlayer } from './types';

export const NHL_WEB = 'https://api-web.nhle.com/v1';
export const NHL_STATS = 'https://api.nhle.com/stats/rest/en';

export const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD',
  'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
] as const;

/** NHL position codes → the fantasy positions lineups use. */
export function nhlPosition(code: unknown): string {
  switch (code) {
    case 'L':
      return 'LW';
    case 'R':
      return 'RW';
    case 'C':
    case 'D':
    case 'G':
      return code;
    default:
      return 'UTIL';
  }
}

/** "20262027" → the season the stats API numbers before it, "20252026". */
export function previousNhlSeason(season: string): string {
  const start = Number(season.slice(0, 4));
  return `${start - 1}${start}`;
}

/** The season in NHL numbering for a date: it rolls over in September. */
export function nhlSeasonFor(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 8 ? y : y - 1;
  return `${start}${start + 1}`;
}

type Named = { default?: string } | undefined;
const nm = (n: Named) => (n && typeof n.default === 'string' ? n.default : '');

/** "60:00" → minutes. */
function toiMinutes(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const [m, s] = v.split(':').map(Number);
  return (m || 0) + (s || 0) / 60;
}

export type NhlGameState = 'pre' | 'live' | 'final';

export function nhlGameState(s: unknown): NhlGameState {
  if (s === 'LIVE' || s === 'CRIT') return 'live';
  if (s === 'OFF' || s === 'FINAL') return 'final';
  return 'pre';
}

export type NhlGame = { id: string; start: string; state: NhlGameState; home: string; away: string };

/** Games out of /schedule/{date} (a week) or /score/{date} (a day). */
export function parseNhlGames(json: unknown): NhlGame[] {
  const j = (json ?? {}) as { gameWeek?: { games?: unknown[] }[]; games?: unknown[] };
  const raw = j.gameWeek ? j.gameWeek.flatMap((d) => d.games ?? []) : (j.games ?? []);
  const out: NhlGame[] = [];
  for (const g of raw as Record<string, unknown>[]) {
    const home = (g.homeTeam as { abbrev?: string } | undefined)?.abbrev;
    const away = (g.awayTeam as { abbrev?: string } | undefined)?.abbrev;
    // Regular season and playoffs only — preseason doesn't count.
    if (!home || !away || g.id == null || (g.gameType !== 2 && g.gameType !== 3)) continue;
    out.push({ id: String(g.id), start: String(g.startTimeUTC ?? ''), state: nhlGameState(g.gameState), home, away });
  }
  return out;
}

export type GameLines = { gameId: string; state: NhlGameState; start: string; lines: Map<string, StatLine> };

function skaterLine(p: Record<string, unknown>): StatLine {
  return {
    goals: num(p.goals) ?? 0,
    assists: num(p.assists) ?? 0,
    ppGoals: num(p.powerPlayGoals) ?? 0,
    shots: num(p.sog) ?? 0,
    hits: num(p.hits) ?? 0,
    blockedShots: num(p.blockedShots) ?? 0,
    plusMinus: num(p.plusMinus) ?? 0,
    pim: num(p.pim) ?? 0,
  };
}

function goalieLine(p: Record<string, unknown>, final: boolean): StatLine | null {
  // A dressed backup who never went in has no time on ice: no line at all.
  if (toiMinutes(p.toi) === 0) return null;
  const ga = num(p.goalsAgainst) ?? 0;
  const win = p.decision === 'W';
  return {
    saves: num(p.saves) ?? 0,
    goalsAgainst: ga,
    wins: win ? 1 : 0,
    // Only once it's over: 0 goals against in the 2nd period is not a shutout yet.
    shutouts: final && win && ga === 0 && toiMinutes(p.toi) >= 59.9 ? 1 : 0,
  };
}

/** Every player's stat line from /gamecenter/{id}/boxscore. Empty before puck drop. */
export function parseNhlBoxscore(json: unknown): GameLines {
  const j = (json ?? {}) as Record<string, unknown>;
  const state = nhlGameState(j.gameState);
  const lines = new Map<string, StatLine>();
  const by = (j.playerByGameStats ?? {}) as Record<string, Record<string, Record<string, unknown>[]> | undefined>;
  for (const side of [by.homeTeam, by.awayTeam]) {
    if (!side) continue;
    for (const p of [...(side.forwards ?? []), ...(side.defense ?? [])]) {
      if (p.playerId != null) lines.set(String(p.playerId), skaterLine(p));
    }
    for (const p of side.goalies ?? []) {
      const line = goalieLine(p, state === 'final');
      if (p.playerId != null && line) lines.set(String(p.playerId), line);
    }
  }
  return { gameId: String(j.id ?? ''), state, start: String(j.startTimeUTC ?? ''), lines };
}

type StatsRows = { data?: Record<string, unknown>[] };

/**
 * The draft pool: everyone on a current NHL roster, carrying last season's
 * totals (zeros for rookies). Rosters decide who exists and where; the
 * stats API decides how good they were.
 */
export function buildNhlPool(
  rosters: { team: string; json: unknown }[],
  skaterSummary: unknown,
  skaterRealtime: unknown,
  goalieSummary: unknown
): PoolPlayer[] {
  const realtime = new Map(((skaterRealtime as StatsRows)?.data ?? []).map((r) => [String(r.playerId), r]));
  const season = new Map<string, { line: StatLine; gp: number }>();
  for (const r of (skaterSummary as StatsRows)?.data ?? []) {
    const rt = realtime.get(String(r.playerId)) ?? {};
    season.set(String(r.playerId), {
      gp: num(r.gamesPlayed) ?? 0,
      line: {
        goals: num(r.goals) ?? 0,
        assists: num(r.assists) ?? 0,
        ppGoals: num(r.ppGoals) ?? 0,
        shots: num(r.shots) ?? 0,
        plusMinus: num(r.plusMinus) ?? 0,
        pim: num(r.penaltyMinutes) ?? 0,
        hits: num(rt.hits) ?? 0,
        blockedShots: num(rt.blockedShots) ?? 0,
      },
    });
  }
  for (const r of (goalieSummary as StatsRows)?.data ?? []) {
    season.set(String(r.playerId), {
      gp: num(r.gamesPlayed) ?? 0,
      line: {
        wins: num(r.wins) ?? 0,
        saves: num(r.saves) ?? 0,
        goalsAgainst: num(r.goalsAgainst) ?? 0,
        shutouts: num(r.shutouts) ?? 0,
      },
    });
  }

  const out: PoolPlayer[] = [];
  const seen = new Set<string>();
  for (const { team, json } of rosters) {
    const r = (json ?? {}) as Record<string, Record<string, unknown>[] | undefined>;
    for (const p of [...(r.forwards ?? []), ...(r.defensemen ?? []), ...(r.goalies ?? [])]) {
      const id = String(p.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const s = season.get(id);
      out.push({
        id,
        name: `${nm(p.firstName as Named)} ${nm(p.lastName as Named)}`.trim() || id,
        position: nhlPosition(p.positionCode),
        team,
        seasonLine: s?.line ?? {},
        gamesPlayed: s?.gp ?? 0,
      });
    }
  }
  return out;
}

/**
 * Stats-API-only pool, for when rosters can't be read: last season's
 * players at last season's teams (a traded player shows his last team).
 */
export function nhlPoolFromStats(skaterSummary: unknown, skaterRealtime: unknown, goalieSummary: unknown): PoolPlayer[] {
  const rosters = new Map<string, { forwards: unknown[]; defensemen: unknown[]; goalies: unknown[] }>();
  const add = (team: string, kind: 'forwards' | 'defensemen' | 'goalies', p: unknown) => {
    if (!rosters.has(team)) rosters.set(team, { forwards: [], defensemen: [], goalies: [] });
    rosters.get(team)![kind].push(p);
  };
  const split = (full: unknown) => {
    const parts = String(full ?? '').split(' ');
    return { firstName: { default: parts[0] ?? '' }, lastName: { default: parts.slice(1).join(' ') } };
  };
  const lastTeam = (t: unknown) => String(t ?? '').split(',').pop()?.trim() || 'FA';
  for (const r of (skaterSummary as StatsRows)?.data ?? []) {
    add(lastTeam(r.teamAbbrevs), r.positionCode === 'D' ? 'defensemen' : 'forwards', {
      id: r.playerId,
      positionCode: r.positionCode,
      ...split(r.skaterFullName),
    });
  }
  for (const r of (goalieSummary as StatsRows)?.data ?? []) {
    add(lastTeam(r.teamAbbrevs), 'goalies', { id: r.playerId, positionCode: 'G', ...split(r.goalieFullName) });
  }
  return buildNhlPool(
    [...rosters].map(([team, json]) => ({ team, json })),
    skaterSummary,
    skaterRealtime,
    goalieSummary
  );
}
