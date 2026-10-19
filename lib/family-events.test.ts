import { describe, expect, it } from 'vitest';
import type { FantasyEvent } from '@/src/sports/events';
import { toFamilyEvents } from './family-events';

const ev = (type: FantasyEvent['type'], id: string = type): FantasyEvent => ({
  id,
  type,
  at: 1_791_427_200_000,
  app: '128bitfantasy',
  league: { provider: 'espn', id: '1', name: 'Dad League', sport: 'nfl', season: '2026' },
  teamId: 't1',
  period: 7,
  title: 'You won week 7 vs Taco Corp',
  body: 'Dad League · now 5-2',
});

describe('fantasy → 128bit family feed', () => {
  it('sends results and lineup fixes', () => {
    const out = toFamilyEvents([ev('matchup.won'), ev('matchup.lost'), ev('matchup.tied'), ev('lineup.fixed')]);
    expect(out.map((e) => e.type)).toEqual(['matchup.won', 'matchup.lost', 'matchup.tied', 'lineup.fixed']);
  });

  it('keeps in-the-moment alerts on the phone', () => {
    expect(toFamilyEvents([ev('lineup.problem'), ev('lineup.bench')])).toEqual([]);
  });

  it('keeps the stable id, so a repeat replaces instead of doubling', () => {
    const [e] = toFamilyEvents([ev('matchup.won', 'espn:1:t1:matchup.won:g7')]);
    expect(e).toEqual({
      id: 'fantasy-espn:1:t1:matchup.won:g7',
      app: 'fantasy',
      type: 'matchup.won',
      at: 1_791_427_200_000,
      data: { title: 'You won week 7 vs Taco Corp', league: 'Dad League', sport: 'nfl', week: 7, detail: 'Dad League · now 5-2' },
    });
  });
});
