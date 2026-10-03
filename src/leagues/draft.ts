/**
 * Snake draft: order, whose turn, who's left, and auto-pick.
 */
import { fantasyPoints, type ScoringRules } from './scoring';
import { SLOT_ACCEPTS, type DraftPick, type LeagueSettings, type PoolPlayer, type RosterSlots } from './types';

export function rosterSize(s: Pick<LeagueSettings, 'slots' | 'bench'>): number {
  return Object.values(s.slots).reduce((a, b) => a + b, 0) + s.bench;
}

/** Team on the clock for each pick number (0-based), snaking every round. */
export function snakeTeam(order: string[], pickNo: number): string {
  const n = order.length;
  const round = Math.floor(pickNo / n);
  const i = pickNo % n;
  return order[round % 2 === 0 ? i : n - 1 - i];
}

export function totalPicks(order: string[], s: Pick<LeagueSettings, 'slots' | 'bench'>): number {
  return order.length * rosterSize(s);
}

export type DraftState = {
  /** The next pick number, or null when the draft is over. */
  pickNo: number | null;
  onClock: string | null;
  round: number | null;
  taken: Set<string>;
};

export function draftState(order: string[], settings: Pick<LeagueSettings, 'slots' | 'bench'>, picks: DraftPick[]): DraftState {
  const taken = new Set(picks.map((p) => p.playerId));
  const next = picks.length;
  if (order.length === 0 || next >= totalPicks(order, settings)) return { pickNo: null, onClock: null, round: null, taken };
  return { pickNo: next, onClock: snakeTeam(order, next), round: Math.floor(next / order.length) + 1, taken };
}

/** Random order for the draft, from a seed so every phone agrees if it's ever re-derived. */
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

export function slotTakes(slot: string, position: string): boolean {
  const accepts = SLOT_ACCEPTS[slot];
  if (!accepts) return slot === position;
  return accepts.includes('*') || accepts.includes(position);
}

/**
 * Starting slots still empty after placing `positions` greedily — exact slots
 * first, flexible ones (UTIL, FLEX) last, so a C fills C before UTIL.
 */
export function openSlots(slots: RosterSlots, positions: string[]): string[] {
  const open: string[] = [];
  for (const [slot, n] of Object.entries(slots)) for (let i = 0; i < n; i++) open.push(slot);
  const flexible = (s: string) => (SLOT_ACCEPTS[s] ? 1 : 0);
  open.sort((a, b) => flexible(a) - flexible(b));
  for (const pos of positions) {
    const i = open.findIndex((s) => slotTakes(s, pos));
    if (i >= 0) open.splice(i, 1);
  }
  return open;
}

/**
 * The best player left who fits: while starting slots are open, only
 * positions that fill one; after that, best available while the bench has
 * room. Kickers and defenses wait for the last two rounds, like people do.
 */
export function autoPick(
  ranked: (PoolPlayer & { value: number })[],
  taken: Set<string>,
  mine: PoolPlayer[],
  settings: Pick<LeagueSettings, 'slots' | 'bench'>,
  round: number
): PoolPlayer | null {
  const open = openSlots(settings.slots, mine.map((p) => p.position));
  const roundsLeft = rosterSize(settings) - mine.length;
  const latePositions = new Set(['K', 'DEF']);
  const fits = (p: PoolPlayer) => open.some((s) => slotTakes(s, p.position));
  // Open slots that only a K or DEF can fill must be filled before the end.
  const mustLate = open.filter((s) => latePositions.has(s)).length;
  const available = ranked.filter((p) => !taken.has(p.id));
  if (roundsLeft <= 0) return null;
  if (mustLate > 0 && roundsLeft <= mustLate) return available.find((p) => latePositions.has(p.position) && fits(p)) ?? null;
  const early = (p: PoolPlayer) => !latePositions.has(p.position) || round > rosterSize(settings) - 2;
  if (open.length > 0) {
    const pick = available.find((p) => fits(p) && early(p));
    if (pick) return pick;
  }
  return available.find((p) => early(p) && !latePositions.has(p.position)) ?? available[0] ?? null;
}
