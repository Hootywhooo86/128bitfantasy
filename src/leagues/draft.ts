/**
 * Drafts: snake / linear order (after pick trades), whose turn, who's left,
 * auto-pick, and the auction maths. Matches the database functions in
 * supabase/schema.sql (draft_team, pick_owner, draft_rounds, max_bid).
 */
import { fantasyPoints, type HostedSport, type ScoringRules } from './scoring';
import { isFlexSlot, slotTakes, type DraftPick, type DraftType, type LeagueSettings, type PoolPlayer, type RosterSlots } from './types';

export { slotTakes };

export function rosterSize(s: Pick<LeagueSettings, 'slots' | 'bench'>): number {
  return Object.values(s.slots).reduce((a, b) => a + b, 0) + s.bench;
}

/**
 * Rounds in the draft. A league's first season drafts full rosters; after
 * that, the league's setting or the roster minus keepers.
 */
export function draftRounds(s: Pick<LeagueSettings, 'slots' | 'bench'> & Partial<Pick<LeagueSettings, 'keepers' | 'draftRounds'>>, firstSeason = true): number {
  if (firstSeason) return rosterSize(s);
  return Math.max(1, s.draftRounds ?? rosterSize(s) - (s.keepers ?? 0));
}

/** The team a pick number (0-based) started with: snake reverses every other round, linear never does. */
export function snakeTeam(order: string[], pickNo: number, type: DraftType = 'snake'): string {
  const n = order.length;
  const round = Math.floor(pickNo / n);
  const i = pickNo % n;
  return order[type === 'linear' || round % 2 === 0 ? i : n - 1 - i];
}

/** A tradeable pick: "season:round:original team id". */
export const pickKey = (season: string, round: number, originalTeam: string) => `${season}:${round}:${originalTeam}`;

export function parsePick(key: string): { season: string; round: number; originalTeam: string } | null {
  const [season, round, originalTeam] = key.split(':');
  const r = Number(round);
  return season && originalTeam && Number.isInteger(r) ? { season, round: r, originalTeam } : null;
}

/** "2027:1:<team>" → "2027 round 1 (Team A's)". */
export function pickLabel(key: string, teamName: (t: string) => string): string {
  const p = parsePick(key);
  return p ? `${p.season} round ${p.round} (${teamName(p.originalTeam)}'s)` : key;
}

/** Pick owners after trades, keyed by pickKey. Missing = still the original team's. */
export type PickOwners = Map<string, string>;

export type DraftState = {
  /** The next pick number, or null when the draft is over. */
  pickNo: number | null;
  onClock: string | null;
  /** The team the pick on the clock started with, when it's been traded. */
  via: string | null;
  round: number | null;
  rounds: number;
  taken: Set<string>;
};

export function draftState(
  order: string[],
  settings: Pick<LeagueSettings, 'slots' | 'bench'> & Partial<Pick<LeagueSettings, 'keepers' | 'draftRounds' | 'draftType'>>,
  picks: DraftPick[],
  opts: { season?: string; owners?: PickOwners; firstSeason?: boolean; keptIds?: string[] } = {}
): DraftState {
  const taken = new Set([...picks.map((p) => p.playerId), ...(opts.keptIds ?? [])]);
  const rounds = draftRounds(settings, opts.firstSeason ?? true);
  const next = picks.length;
  if (order.length === 0 || next >= order.length * rounds) return { pickNo: null, onClock: null, via: null, round: null, rounds, taken };
  const round = Math.floor(next / order.length) + 1;
  const original = snakeTeam(order, next, settings.draftType === 'linear' ? 'linear' : 'snake');
  const owner = opts.owners?.get(pickKey(opts.season ?? '', round, original)) ?? original;
  return { pickNo: next, onClock: owner, via: owner === original ? null : original, round, rounds, taken };
}

/**
 * Every pick a team holds for a season, with whether it's still to come
 * (tradeable). Matches pick_open in the database.
 */
export function teamPicks(
  teamId: string,
  teamIds: string[],
  season: string,
  rounds: number,
  owners: PickOwners
): string[] {
  const out: string[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (const orig of teamIds) {
      const k = pickKey(season, r, orig);
      if ((owners.get(k) ?? orig) === teamId) out.push(k);
    }
  }
  return out;
}

/** Whether a pick in the current season's draft has already been made. */
export function pickUsed(key: string, order: string[], draftType: DraftType, picksMade: number): boolean {
  const p = parsePick(key);
  if (!p || order.length === 0) return false;
  const n = order.length;
  const pos = order.indexOf(p.originalTeam);
  const idx = draftType === 'linear' || p.round % 2 === 1 ? pos : n - 1 - pos;
  return (p.round - 1) * n + idx < picksMade;
}

/** Random order for the draft. */
export function shuffleOrder(teamIds: string[], random: () => number = Math.random): string[] {
  const a = [...teamIds];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Players ranked best-first by last season in this league's scoring. */
export function rankPool(pool: PoolPlayer[], rules: ScoringRules): (PoolPlayer & { value: number })[] {
  return pool
    .map((p) => ({ ...p, value: fantasyPoints(p.seasonLine, rules) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/**
 * Starting slots still empty after placing `positions` greedily — exact slots
 * first, flexible ones (UTIL, FLEX) last, so a C fills C before UTIL.
 */
export function openSlots(slots: RosterSlots, positions: string[], sport: HostedSport = 'nhl'): string[] {
  const open: string[] = [];
  for (const [slot, n] of Object.entries(slots)) for (let i = 0; i < n; i++) open.push(slot);
  const flexible = (s: string) => (isFlexSlot(s, sport) ? 1 : 0);
  open.sort((a, b) => flexible(a) - flexible(b));
  for (const pos of positions) {
    const i = open.findIndex((s) => slotTakes(s, pos, sport));
    if (i >= 0) open.splice(i, 1);
  }
  return open;
}

/**
 * The best player left who fits: while starting slots are open, only
 * positions that fill one; after that, best available. Kickers and defenses
 * wait for the last two rounds, like people do.
 */
export function autoPick(
  ranked: (PoolPlayer & { value: number })[],
  taken: Set<string>,
  mine: PoolPlayer[],
  settings: Pick<LeagueSettings, 'slots' | 'bench'>,
  round: number,
  sport: HostedSport = 'nhl',
  rounds = rosterSize(settings)
): PoolPlayer | null {
  const open = openSlots(settings.slots, mine.map((p) => p.position), sport);
  const roundsLeft = rounds - round + 1;
  const latePositions = new Set(['K', 'DEF']);
  const fits = (p: PoolPlayer) => open.some((s) => slotTakes(s, p.position, sport));
  // Open slots that only a K or DEF can fill must be filled before the end.
  const mustLate = open.filter((s) => latePositions.has(s)).length;
  const available = ranked.filter((p) => !taken.has(p.id));
  if (roundsLeft <= 0) return null;
  if (mustLate > 0 && roundsLeft <= mustLate) return available.find((p) => latePositions.has(p.position) && fits(p)) ?? null;
  const early = (p: PoolPlayer) => !latePositions.has(p.position) || round > rounds - 2;
  if (open.length > 0) {
    const pick = available.find((p) => fits(p) && early(p));
    if (pick) return pick;
  }
  return available.find((p) => early(p) && !latePositions.has(p.position)) ?? available[0] ?? null;
}

/** Auction: the most a team can bid — its budget, keeping $1 for every other spot it must fill. */
export function maxBid(budget: number, needs: number): number {
  return needs <= 0 ? 0 : budget - Math.max(needs - 1, 0);
}

/** Auction: who nominates next — the next team in order, from `start`, that still needs players. */
export function nextNominator(order: string[], start: number, needs: (team: string) => number): string | null {
  for (let i = 0; i < order.length; i++) {
    const t = order[(start + i) % order.length];
    if (needs(t) > 0) return t;
  }
  return null;
}

/**
 * A rough auction value: the player's share of the league's money, by how
 * far he stands above the last player who'd be drafted. Helps people bid.
 */
export function auctionValues(ranked: (PoolPlayer & { value: number })[], teams: number, rounds: number, budget: number): Map<string, number> {
  const drafted = ranked.slice(0, teams * rounds);
  const floor = drafted.length ? drafted[drafted.length - 1].value : 0;
  const above = drafted.map((p) => Math.max(0, p.value - floor));
  const sum = above.reduce((a, b) => a + b, 0) || 1;
  const spare = teams * budget - drafted.length;
  return new Map(drafted.map((p, i) => [p.id, Math.max(1, Math.round(1 + (above[i] / sum) * spare))]));
}
