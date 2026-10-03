/**
 * NFL stats for hosted football leagues — Sleeper's free stats feed, no key.
 *
 * api.sleeper.app/v1/stats/nfl/regular/{season}/{week}: one week, every player.
 * api.sleeper.app/v1/stats/nfl/regular/{season}: season totals, for the draft.
 * Keys are Sleeper player ids — the same ids as the Sleeper player catalog
 * this app already caches — and team defenses are keyed by team ("BUF").
 *
 * Kickoff times come from the ESPN scoreboard (src/betting/odds.ts), which
 * decides when a player's lineup slot locks.
 */
import { num } from '@/src/sports/models';
import type { StatLine } from './scoring';
import type { PoolPlayer } from './types';

export const SLEEPER_STATS = 'https://api.sleeper.app/v1/stats/nfl/regular';

export const NFL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

/** Sleeper's stat object for a player → just the numbers. */
function toLine(raw: unknown): StatLine {
  const out: StatLine = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const n = num(v);
    if (n != null) out[k] = n;
  }
  return out;
}

/**
 * A week of stats. Sleeper also sends TEAM_XXX team-offense rows; those are
 * not players and are dropped.
 */
export function parseSleeperWeek(json: unknown): Map<string, StatLine> {
  const out = new Map<string, StatLine>();
  for (const [id, raw] of Object.entries((json ?? {}) as Record<string, unknown>)) {
    if (id.startsWith('TEAM_')) continue;
    out.set(id, toLine(raw));
  }
  return out;
}

/** The trimmed Sleeper catalog entry (lib/storage/player-cache.ts). */
type CatalogPlayer = { full_name?: string | null; position?: string | null; team?: string | null };

/**
 * The draft pool: active players at fantasy positions from the Sleeper
 * catalog, plus the 32 defenses, with last season's totals.
 */
export function buildNflPool(catalog: Record<string, CatalogPlayer>, seasonStats: unknown): PoolPlayer[] {
  const season = parseSleeperWeek(seasonStats);
  const out: PoolPlayer[] = [];
  for (const [id, p] of Object.entries(catalog)) {
    const pos = p.position ?? '';
    if (!(NFL_POSITIONS as readonly string[]).includes(pos)) continue;
    // Free agents (no team) can't score; leave them out of the draft.
    if (!p.team) continue;
    const line = season.get(id) ?? {};
    out.push({
      id,
      name: pos === 'DEF' ? `${p.full_name ?? id} D/ST` : (p.full_name ?? id),
      position: pos,
      team: p.team,
      seasonLine: line,
      gamesPlayed: line.gp ?? 0,
    });
  }
  return out;
}
