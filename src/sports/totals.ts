/**
 * Team totals for a matchup: points scored so far by the starters, and the
 * starters' projected points for the period. Pure.
 */
import type { PlayerInsight } from './insights';
import type { Roster } from './models';

export type TeamTotals = { points: number | null; projected: number | null };

export function teamTotals(roster: Roster | undefined, insights: Record<string, PlayerInsight>): TeamTotals {
  if (!roster) return { points: null, projected: null };
  const starters = roster.players.filter((p) => p.slot === 'starter');
  const withPts = starters.filter((p) => p.points != null);
  const withProj = starters.filter((p) => insights[p.id]?.projection != null);
  return {
    points: withPts.length ? round(withPts.reduce((n, p) => n + (p.points ?? 0), 0)) : null,
    // Out players have no projection: they add 0, which is what they will score.
    projected: withProj.length ? round(starters.reduce((n, p) => n + (insights[p.id]?.projection ?? 0), 0)) : null,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
