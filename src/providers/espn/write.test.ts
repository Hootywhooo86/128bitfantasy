import { describe, expect, it } from 'vitest';
import { lineupItems, slotIdFor } from './write';

const entries = [
  { playerId: 1, lineupSlotId: 2, eligible: [2, 3, 23, 20, 21] }, // RB starter
  { playerId: 2, lineupSlotId: 20, eligible: [2, 3, 23, 20, 21] }, // RB on bench
  { playerId: 3, lineupSlotId: 20, eligible: [0, 7, 20, 21] }, // QB on bench
];

describe('ESPN lineup moves', () => {
  it('maps slot names back to ESPN ids', () => {
    expect(slotIdFor('nfl', 'FLEX')).toBe(23);
    expect(slotIdFor('nhl', 'UTIL')).toBe(6);
    expect(slotIdFor('nfl', 'NOPE')).toBeNull();
  });

  it('benches the starter and starts the bench player in his spot', () => {
    expect(lineupItems('nfl', entries, '2', '1', 'RB')).toEqual([
      { playerId: 1, type: 'LINEUP', fromLineupSlotId: 2, toLineupSlotId: 20 },
      { playerId: 2, type: 'LINEUP', fromLineupSlotId: 20, toLineupSlotId: 2 },
    ]);
  });

  it('fills an empty spot by name', () => {
    expect(lineupItems('nfl', entries, '2', null, 'FLEX')).toEqual([{ playerId: 2, type: 'LINEUP', fromLineupSlotId: 20, toLineupSlotId: 23 }]);
  });

  it("refuses a spot ESPN says he can't play", () => {
    expect(() => lineupItems('nfl', entries, '3', '1', 'RB')).toThrow(/won't let him play RB/);
    expect(() => lineupItems('nfl', entries, '9', null, 'RB')).toThrow(/no longer on your team/);
  });
});
