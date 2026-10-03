import { describe, expect, it } from 'vitest';
import type { PlayerInsight } from './insights';
import type { RosterPlayer } from './models';
import { teamTotals } from './totals';

const pl = (id: string, slot: RosterPlayer['slot'], points: number | null): RosterPlayer => ({
  id, name: id, position: 'WR', lineupSlot: 'WR', slot, proTeam: null, injury: null, points,
});
const ins = (projection: number | null) => ({ projection }) as PlayerInsight;

describe('team totals', () => {
  it('adds starters only; out players count 0 toward the projection', () => {
    const r = { teamId: 'a', players: [pl('a', 'starter', 12.9), pl('b', 'starter', 0), pl('c', 'starter', 0), pl('d', 'bench', 13.9)] };
    expect(teamTotals(r, { a: ins(10.6), b: ins(18.8), c: ins(null), d: ins(15) })).toEqual({ points: 12.9, projected: 29.4 });
  });

  it('says nothing rather than 0 when nothing is reported', () => {
    expect(teamTotals({ teamId: 'a', players: [{ ...pl('a', 'starter', null) }] }, {})).toEqual({ points: null, projected: null });
    expect(teamTotals(undefined, {})).toEqual({ points: null, projected: null });
  });
});
