/**
 * Category scoring: head-to-head categories, most categories, and roto.
 *
 * A category is a stat total (goals) or a ratio of two totals (save % =
 * saves / shots against), compared per team. Some are better low (GAA,
 * goals against, interceptions thrown).
 */
import type { HostedSport, StatLine } from './scoring';

export type CategoryDef = {
  key: string;
  label: string;
  /** Lower wins (GAA, turnovers). */
  lowerBetter?: boolean;
  /** A ratio of two summed stats, times `scale`. */
  ratio?: { num: string; den: string; scale?: number };
  /** Decimal places shown. */
  digits?: number;
};

export const CATEGORIES: Record<HostedSport, CategoryDef[]> = {
  nhl: [
    { key: 'goals', label: 'G' },
    { key: 'assists', label: 'A' },
    { key: 'points', label: 'P' },
    { key: 'plusMinus', label: '+/-' },
    { key: 'pim', label: 'PIM' },
    { key: 'ppGoals', label: 'PPG' },
    { key: 'shots', label: 'SOG' },
    { key: 'hits', label: 'HIT' },
    { key: 'blockedShots', label: 'BLK' },
    { key: 'wins', label: 'W' },
    { key: 'saves', label: 'SV' },
    { key: 'goalsAgainst', label: 'GA', lowerBetter: true },
    { key: 'gaa', label: 'GAA', lowerBetter: true, ratio: { num: 'goalsAgainst', den: 'goalieMinutes', scale: 60 }, digits: 2 },
    { key: 'savePct', label: 'SV%', ratio: { num: 'saves', den: 'shotsAgainst' }, digits: 3 },
    { key: 'shutouts', label: 'SHO' },
  ],
  nfl: [
    { key: 'pass_yd', label: 'Pass Yds' },
    { key: 'pass_td', label: 'Pass TD' },
    { key: 'pass_int', label: 'INT', lowerBetter: true },
    { key: 'rush_yd', label: 'Rush Yds' },
    { key: 'rush_td', label: 'Rush TD' },
    { key: 'rec', label: 'Rec' },
    { key: 'rec_yd', label: 'Rec Yds' },
    { key: 'rec_td', label: 'Rec TD' },
    { key: 'fum_lost', label: 'Fum Lost', lowerBetter: true },
    { key: 'sack', label: 'Sacks' },
    { key: 'int', label: 'Def INT' },
    { key: 'fgm', label: 'FG Made' },
  ],
};

/** The usual 10-category hockey league (Yahoo default) and a basic football set. */
export const DEFAULT_CATEGORIES: Record<HostedSport, string[]> = {
  nhl: ['goals', 'assists', 'plusMinus', 'pim', 'ppGoals', 'shots', 'wins', 'gaa', 'savePct', 'shutouts'],
  nfl: ['pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td', 'fum_lost'],
};

export function categoryDefs(sport: HostedSport, keys: string[]): CategoryDef[] {
  const all = new Map(CATEGORIES[sport].map((c) => [c.key, c]));
  return keys.map((k) => all.get(k)).filter((c): c is CategoryDef => !!c);
}

/** A team's value in a category, or null when it can't be worked out (no goalie minutes yet). */
export function catValue(def: CategoryDef, totals: StatLine): number | null {
  if (def.ratio) {
    const den = totals[def.ratio.den] ?? 0;
    if (!den) return null;
    return ((totals[def.ratio.num] ?? 0) / den) * (def.ratio.scale ?? 1);
  }
  return totals[def.key] ?? 0;
}

export function formatCat(def: CategoryDef, v: number | null): string {
  if (v == null) return '—';
  if (def.key === 'savePct') return v.toFixed(3).replace(/^0/, '');
  return def.digits ? v.toFixed(def.digits) : String(Math.round(v * 10) / 10);
}

export type CatOutcome = 'win' | 'loss' | 'tie';

/** One category, A vs B. A missing ratio loses to any real one; two missing tie. */
export function compareCat(def: CategoryDef, a: number | null, b: number | null): CatOutcome {
  if (a == null && b == null) return 'tie';
  if (a == null) return 'loss';
  if (b == null) return 'win';
  const eps = 1e-9;
  if (Math.abs(a - b) < eps) return 'tie';
  return (def.lowerBetter ? a < b : a > b) ? 'win' : 'loss';
}

export type CatMatch = { wins: number; losses: number; ties: number; byCat: { key: string; a: number | null; b: number | null; result: CatOutcome }[] };

export function h2hCats(defs: CategoryDef[], a: StatLine, b: StatLine): CatMatch {
  const out: CatMatch = { wins: 0, losses: 0, ties: 0, byCat: [] };
  for (const d of defs) {
    const va = catValue(d, a);
    const vb = catValue(d, b);
    const r = compareCat(d, va, vb);
    if (r === 'win') out.wins++;
    else if (r === 'loss') out.losses++;
    else out.ties++;
    out.byCat.push({ key: d.key, a: va, b: vb, result: r });
  }
  return out;
}

/**
 * Rotisserie: in each category the best team gets N points, the worst 1,
 * ties share the average. Highest total wins the league.
 */
export function rotoPoints(defs: CategoryDef[], totals: Map<string, StatLine>): Map<string, { total: number; byCat: Record<string, number> }> {
  const teams = [...totals.keys()];
  const out = new Map(teams.map((t) => [t, { total: 0, byCat: {} as Record<string, number> }]));
  for (const d of defs) {
    const vals = teams.map((t) => ({ t, v: catValue(d, totals.get(t)!) }));
    // Worst first; a missing value is the worst there is.
    vals.sort((x, y) => {
      if (x.v == null) return y.v == null ? 0 : -1;
      if (y.v == null) return 1;
      return d.lowerBetter ? y.v - x.v : x.v - y.v;
    });
    let i = 0;
    while (i < vals.length) {
      let j = i;
      while (j + 1 < vals.length && vals[j + 1].v === vals[i].v) j++;
      const pts = (i + 1 + (j + 1)) / 2;
      for (let k = i; k <= j; k++) {
        const row = out.get(vals[k].t)!;
        row.byCat[d.key] = pts;
        row.total += pts;
      }
      i = j + 1;
    }
  }
  return out;
}
