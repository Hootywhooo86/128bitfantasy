import { describe, expect, it } from 'vitest';
import { buildLeagueContext, cornerQuestion, tradeQuestion } from './coach-context';
import { snapshotProblems, type LeagueSnapshot } from './models';

const snap: LeagueSnapshot = {
  league: { provider: 'sleeper', id: '1', name: 'Pixel Bowl', sport: 'nfl', season: '2026', teamCount: 3, myTeamId: 'a', scoring: 'PPR' },
  teams: [
    { id: 'a', name: 'Mine', owner: 'me', record: { wins: 3, losses: 1, ties: 0 }, pointsFor: 500, pointsAgainst: 400, rank: 1 },
    { id: 'b', name: 'Theirs', owner: 'them', record: { wins: 1, losses: 3, ties: 0 }, pointsFor: null, pointsAgainst: null, rank: 2 },
    { id: 'c', name: 'Third', owner: 'x', record: { wins: 2, losses: 2, ties: 0 }, pointsFor: 410, pointsAgainst: 420, rank: 3 },
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
    { teamId: 'c', players: [{ id: '9', name: 'Their RB', position: 'RB', lineupSlot: 'RB', slot: 'starter', proTeam: 'DET', injury: null }] },
  ],
  matchups: [
    { period: 4, home: { teamId: 'b', points: null }, away: { teamId: 'a', points: 12.3 } },
    { period: 4, home: { teamId: 'c', points: 5 }, away: null },
  ],
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

  it('passes the lineup check to the coach', () => {
    expect(ctx).toContain('Lineup check');
    expect(ctx).toContain('QB: Star QB is QUESTIONABLE');
  });

  it('asks the user when it cannot tell which team is theirs', () => {
    const c = buildLeagueContext({ ...snap, league: { ...snap.league, myTeamId: null } });
    expect(c).toContain('ask them');
    expect(c).not.toContain('My roster');
  });

  it('scouts another team, and brings my roster along for trade ideas', () => {
    const c = buildLeagueContext(snap, 'c');
    expect(c).toContain("Team being viewed: Third");
    expect(c).toContain("NOT the user's team");
    expect(c).toContain('This week: bye');
    expect(c).toContain('Viewed team roster:');
    expect(c).toContain('Their RB');
    expect(c).toContain('My roster (for trade ideas):');
  });

  it('does not repeat my roster when scouting my own opponent', () => {
    const c = buildLeagueContext(snap, 'b');
    expect(c).not.toContain('for trade ideas');
    expect(c).toContain('Opponent roster:');
  });

  it('turns plays into questions, different when scouting', () => {
    expect(cornerQuestion('lineup', 'Is it windy in Buffalo?')).toMatch(/START or SIT[\s\S]*Also: Is it windy/);
    expect(cornerQuestion('lineup', '', true)).toMatch(/exploit/);
    expect(cornerQuestion('ask', '')).toContain('one move');
    expect(cornerQuestion('ask', 'Trade Kelce?')).toBe('Trade Kelce?');
  });
});

describe('trade check', () => {
  it('names both sides and asks for a grade and a verdict', () => {
    const q = tradeQuestion(['Star QB'], ['Their RB'], 'Third', 'I need RBs');
    expect(q).toMatch(/A to F/);
    expect(q).toContain('I give: Star QB');
    expect(q).toContain('I get from Third: Their RB');
    expect(q).toContain('Also: I need RBs');
  });

  it('adds the trade partner roster to the context once', () => {
    const c = buildLeagueContext(snap, 'a', ['c', 'b']);
    expect(c).toContain('Third roster:');
    expect(c.match(/Opponent roster/g)).toHaveLength(1);
    expect(c).not.toContain('Theirs roster:');
  });
});

describe('snapshot problems', () => {
  it('flags the signs of an API change', () => {
    expect(snapshotProblems(snap)).toEqual([]);
    expect(snapshotProblems({ ...snap, teams: [] })).toEqual(['no teams came back']);
    expect(snapshotProblems({ ...snap, rosters: [{ teamId: 'a', players: [] }] })).toEqual(['every roster came back empty']);
    expect(
      snapshotProblems({
        ...snap,
        rosters: [{ teamId: 'a', players: [{ id: '7', name: '7', position: null, lineupSlot: null, slot: 'bench', proTeam: null, injury: null }] }],
      })
    ).toEqual(['player names are missing']);
  });
});
