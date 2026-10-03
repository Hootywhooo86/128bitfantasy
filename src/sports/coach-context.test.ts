import { describe, expect, it } from 'vitest';
import { buildLeagueContext, cornerPrompt } from './coach-context';
import type { LeagueSnapshot } from './models';

const snap: LeagueSnapshot = {
  league: { provider: 'sleeper', id: '1', name: 'Pixel Bowl', sport: 'nfl', season: '2026', teamCount: 2, myTeamId: 'a', scoring: 'PPR' },
  teams: [
    { id: 'a', name: 'Mine', owner: 'me', record: { wins: 3, losses: 1, ties: 0 }, pointsFor: 500, pointsAgainst: 400, rank: 1 },
    { id: 'b', name: 'Theirs', owner: 'them', record: { wins: 1, losses: 3, ties: 0 }, pointsFor: null, pointsAgainst: null, rank: 2 },
  ],
  rosters: [
    {
      teamId: 'a',
      players: [
        { id: '2', name: 'Bench Guy', position: 'WR', lineupSlot: 'BN', slot: 'bench', proTeam: 'NYJ', injury: null },
        { id: '1', name: 'Star QB', position: 'QB', lineupSlot: 'QB', slot: 'starter', proTeam: 'KC', injury: 'Questionable' },
      ],
    },
    { teamId: 'b', players: [] },
  ],
  matchups: [{ period: 4, home: { teamId: 'b', points: null }, away: { teamId: 'a', points: 12.3 } }],
  period: 4,
  fetchedAt: Date.UTC(2026, 9, 3),
};

describe('coaches corner context', () => {
  const ctx = buildLeagueContext(snap);

  it('names the league, scoring and week', () => {
    expect(ctx).toContain('Pixel Bowl — Sleeper NFL 2026');
    expect(ctx).toContain('Scoring: PPR');
    expect(ctx).toContain('Period: 4');
  });

  it('puts my side first and shows missing points as a dash, never 0', () => {
    expect(ctx).toContain('vs Theirs (1-3, #2): 12.3 – —');
  });

  it('lists starters before bench and keeps injury tags', () => {
    expect(ctx.indexOf('Star QB')).toBeLessThan(ctx.indexOf('Bench Guy'));
    expect(ctx).toContain('QB Star QB (QB, KC) [Questionable]');
    expect(ctx).toContain('Opponent roster: roster not available');
  });

  it('asks the user when it cannot tell which team is theirs', () => {
    const c = buildLeagueContext({ ...snap, league: { ...snap.league, myTeamId: null } });
    expect(c).toContain('ask them');
    expect(c).not.toContain('My roster');
  });

  it('turns modes into a decision request with the context attached', () => {
    const p = cornerPrompt('lineup', ctx, 'Is it windy in Buffalo?');
    expect(p).toMatch(/START or SIT/);
    expect(p).toContain('Also: Is it windy in Buffalo?');
    expect(p).toContain('--- League context ---');
    expect(cornerPrompt('ask', ctx, '')).toContain('one move');
  });
});
