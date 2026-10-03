/**
 * NBA stats for hosted basketball leagues — Sleeper's free stats feed, no key.
 *
 * api.sleeper.app/stats/nba/{season}/{week}: one row per player per game,
 * with the game's date, team and opponent, updated live.
 * api.sleeper.app/v1/stats/nba/regular/{season}: season totals, for the draft.
 * Tip-off times come from the ESPN scoreboard; ESPN and Sleeper spell a few
 * teams differently.
 */
import { num } from '@/src/sports/models';
import type { StatLine } from './scoring';
import type { PoolPlayer } from './types';

export const SLEEPER_NBA = 'https://api.sleeper.app/stats/nba';
export const SLEEPER_NBA_SEASON = 'https://api.sleeper.app/v1/stats/nba/regular';

/** ESPN abbreviation → Sleeper's. */
export const ESPN_TO_SLEEPER_NBA: Record<string, string> = {
  GS: 'GSW',
  NY: 'NYK',
  SA: 'SAS',
  NO: 'NOP',
  UTAH: 'UTA',
  WSH: 'WAS',
  PHO: 'PHX',
  BKN: 'BKN',
};

const toLine = (raw: unknown): StatLine => {
  const out: StatLine = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const n = num(v);
    if (n != null) out[k] = n;
  }
  return out;
};

export type NbaGameRow = { playerId: string; date: string; team: string; opponent: string; line: StatLine };

/** A week of per-game rows. Rows for games not played yet (no stats) are dropped. */
export function parseNbaWeek(json: unknown): NbaGameRow[] {
  const out: NbaGameRow[] = [];
  for (const r of (Array.isArray(json) ? json : []) as Record<string, unknown>[]) {
    const line = toLine(r.stats);
    // Sleeper lists DNPs and future games with no minutes; nothing to score.
    if (!Object.keys(line).length || !(line.sp || line.pts != null)) continue;
    out.push({
      playerId: String(r.player_id ?? ''),
      date: String(r.date ?? ''),
      team: String(r.team ?? ''),
      opponent: String(r.opponent ?? ''),
      line,
    });
  }
  return out.filter((r) => r.playerId);
}

type NbaCatalog = Record<string, { full_name?: string | null; first_name?: string; last_name?: string; position?: string | null; fantasy_positions?: string[] | null; team?: string | null; active?: boolean }>;

/** Fantasy positions, most specific first: "PG/SG", "SF/PF", "C". */
export function nbaPosition(p: { position?: string | null; fantasy_positions?: string[] | null }): string {
  const fp = (p.fantasy_positions ?? []).filter((x) => ['PG', 'SG', 'SF', 'PF', 'C'].includes(x));
  if (fp.length) return fp.join('/');
  switch (p.position) {
    case 'G':
      return 'PG/SG';
    case 'F':
      return 'SF/PF';
    case 'PG':
    case 'SG':
    case 'SF':
    case 'PF':
    case 'C':
      return p.position;
    default:
      return 'SF/PF';
  }
}

/** The draft pool: active players on a team, with last season's totals. */
export function buildNbaPool(catalog: NbaCatalog, seasonStats: unknown): PoolPlayer[] {
  const season = (seasonStats ?? {}) as Record<string, unknown>;
  const out: PoolPlayer[] = [];
  for (const [id, p] of Object.entries(catalog)) {
    if (!p.team || p.active === false) continue;
    const line = toLine(season[id]);
    out.push({
      id,
      name: p.full_name ?? (`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id),
      position: nbaPosition(p),
      team: p.team,
      seasonLine: line,
      gamesPlayed: line.gp ?? 0,
    });
  }
  return out;
}

/** Sleeper's NBA week for a date: weeks start the Monday of opening week. */
export function sleeperNbaWeek(seasonStartDate: string, at: Date): number {
  const d = new Date(`${seasonStartDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  d.setUTCHours(0);
  return Math.max(1, Math.floor((at.getTime() - d.getTime()) / (7 * 86_400_000)) + 1);
}
