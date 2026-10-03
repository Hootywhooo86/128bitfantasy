import { describe, expect, it } from 'vitest';
import { deriveEvents, shouldNotify } from './events';
import type { LeagueSnapshot, RosterPlayer } from './models';

const p = (id: string, slot: RosterPlayer['slot'], lineupSlot: string, position: string, injury: string | null = null): RosterPlayer => ({
  id,
  name: id.toUpperCase(),
  position,
  lineupSlot,
  slot,
  proTeam: null,
  injury,
});

function snap(over: Partial<LeagueSnapshot> & { wins?: number; losses?: number; injury?: string | null } = {}): LeagueSnapshot {
  return {
    league: { provider: 'sleeper', id: 'L', name: 'Pixel Bowl', sport: 'nfl', season: '2026', teamCount: 2, myTeamId: 'a', scoring: null },
    teams: [
      { id: 'a', name: 'Mine', owner: null, record: { wins: over.wins ?? 2, losses: over.losses ?? 1, ties: 0 }, pointsFor: 1, pointsAgainst: 1, rank: 1 },
      { id: 'b', name: 'Rival', owner: null, record: { wins: 1, losses: 2, ties: 0 }, pointsFor: 1, pointsAgainst: 1, rank: 2 },
    ],
    rosters: [{ teamId: 'a', players: [p('wr', 'starter', 'WR', 'WR', over.injury ?? null), p('wr2', 'bench', 'BN', 'WR')] }],
    matchups: [{ period: 4, home: { teamId: 'a', points: 10 }, away: { teamId: 'b', points: 8 } }],
    period: 4,
    fetchedAt: 0,
    ...over,
  };
}

describe('128bit events', () => {
  it('a win added to the record is a win, named with the opponent', () => {
    const ev = deriveEvents(snap(), snap({ wins: 3, period: 5 }), 1);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'matchup.won', period: 4, title: 'You won week 4 vs Rival', app: '128bitfantasy' });
    // Seeing the same change again gives the same id, so it is stored once.
    expect(deriveEvents(snap(), snap({ wins: 3, period: 5 }), 99)[0].id).toBe(ev[0].id);
  });

  it('a loss too', () => {
    expect(deriveEvents(snap(), snap({ losses: 2 }))[0].type).toBe('matchup.lost');
  });

  it('a starter newly ruled out is an alert with a swap suggestion', () => {
    const ev = deriveEvents(snap(), snap({ injury: 'Out' }));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'lineup.problem', title: 'WR is OUT — WR', body: 'Pixel Bowl: swap in WR2' });
    expect(shouldNotify(ev[0])).toBe(true);
  });

  it('does not repeat a problem that was already there', () => {
    expect(deriveEvents(snap({ injury: 'Out' }), snap({ injury: 'Out' }))).toEqual([]);
  });

  it('notices the fix, quietly', () => {
    const ev = deriveEvents(snap({ injury: 'Out' }), snap());
    expect(ev.map((e) => e.type)).toEqual(['lineup.fixed']);
    expect(shouldNotify(ev[0])).toBe(false);
  });

  it('questionable is not an alert, and no team means no events', () => {
    expect(deriveEvents(snap(), snap({ injury: 'Questionable' }))).toEqual([]);
    const s = snap();
    expect(deriveEvents(null, { ...s, league: { ...s.league, myTeamId: null } })).toEqual([]);
  });
});
