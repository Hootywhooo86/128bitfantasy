import { describe, expect, it } from 'vitest';
import { nflWeekOf, nflWeekStart, teamGames } from './season';
import { NHL_SCORING } from './scoring';
import { hostedSnapshot, weekResults, type HostedInput } from './snapshot';
import type { PoolPlayer } from './types';

const input: HostedInput = {
  league: { id: 'L', name: 'Puck Bunnies', sport: 'nhl', season: '20262027', status: 'season' },
  teams: [
    { id: 'a', leagueId: 'L', owner: 'ua', name: 'Team A' },
    { id: 'b', leagueId: 'L', owner: 'ub', name: 'Team B' },
  ],
  roster: [
    { leagueId: 'L', teamId: 'a', playerId: 'mcd', position: 'C', slot: 'C' },
    { leagueId: 'L', teamId: 'a', playerId: 'bench', position: 'C', slot: 'BN' },
    { leagueId: 'L', teamId: 'b', playerId: 'g', position: 'G', slot: 'G' },
  ],
  matchups: [
    { leagueId: 'L', week: 1, home: 'a', away: 'b' },
    { leagueId: 'L', week: 2, home: 'b', away: 'a' },
  ],
  log: [
    { teamId: 'a', playerId: 'mcd', slot: 'C', at: '2026-10-01T00:00:00Z' },
    { teamId: 'a', playerId: 'bench', slot: 'BN', at: '2026-10-01T00:00:00Z' },
    { teamId: 'b', playerId: 'g', slot: 'G', at: '2026-10-01T00:00:00Z' },
  ],
  weekScores: [
    { week: 1, teamId: 'a', points: 40 },
    { week: 1, teamId: 'b', points: 30 },
  ],
  myTeamId: 'a',
};

const pool = new Map<string, PoolPlayer>([
  ['mcd', { id: 'mcd', name: 'Connor McDavid', position: 'C', team: 'EDM', seasonLine: {}, gamesPlayed: 82 }],
  ['g', { id: 'g', name: 'A Goalie', position: 'G', team: 'BOS', seasonLine: {}, gamesPlayed: 60 }],
]);

describe('hosted snapshot', () => {
  const snap = hostedSnapshot(
    input,
    pool,
    2,
    [
      { playerId: 'mcd', start: '2026-10-13T23:00:00Z', line: { goals: 1, assists: 2 } },
      { playerId: 'bench', start: '2026-10-13T23:00:00Z', line: { goals: 3 } },
      { playerId: 'g', start: '2026-10-13T23:00:00Z', line: { saves: 30, goalsAgainst: 2, wins: 1 } },
    ],
    NHL_SCORING,
    123
  );

  it('looks like any other league', () => {
    expect(snap.league).toMatchObject({ provider: 'bit128', id: 'L', sport: 'nhl', myTeamId: 'a', teamCount: 2 });
    expect(snap.fetchedAt).toBe(123);
    expect(snap.period).toBe(2);
  });

  it('records come from finished weeks only', () => {
    expect(snap.teams.find((t) => t.id === 'a')).toMatchObject({ record: { wins: 1, losses: 0, ties: 0 }, pointsFor: 40, rank: 1 });
    expect(snap.teams.find((t) => t.id === 'b')!.rank).toBe(2);
  });

  it("scores this week's starters, not the bench", () => {
    const [m] = snap.matchups;
    expect(m.home).toEqual({ teamId: 'b', points: 6 + 4 - 2 });
    expect(m.away).toEqual({ teamId: 'a', points: 7 });
    const a = snap.rosters.find((r) => r.teamId === 'a')!;
    expect(a.players.find((p) => p.id === 'mcd')).toMatchObject({ name: 'Connor McDavid', proTeam: 'EDM', slot: 'starter', lineupSlot: 'C', points: 7 });
    expect(a.players.find((p) => p.id === 'bench')).toMatchObject({ slot: 'bench', points: null });
  });

  it('skips a week until both sides are recorded', () => {
    expect(weekResults(input.matchups, [{ week: 1, teamId: 'a', points: 1 }], 3)).toEqual([]);
  });
});

describe('week maths', () => {
  it('shows each team its live game, else its next one', () => {
    const g = teamGames(
      [
        { start: '2026-10-12T23:00:00Z', state: 'final', home: 'EDM', away: 'CGY' },
        { start: '2026-10-14T23:00:00Z', state: 'pre', home: 'VAN', away: 'EDM' },
        { start: '2026-10-13T23:00:00Z', state: 'live', home: 'CGY', away: 'SEA' },
      ],
      Date.parse('2026-10-13T23:30:00Z')
    );
    expect(g.get('EDM')).toMatchObject({ state: 'pre', opponent: 'VAN' });
    expect(g.get('CGY')).toMatchObject({ state: 'live', opponent: 'SEA' });
  });

  it('numbers NFL weeks from the Tuesday before opening night', () => {
    // Sleeper's 2026 season_start_date is Wednesday 2026-09-09.
    expect(nflWeekStart('2026-09-09', 1).toISOString()).toBe('2026-09-08T12:00:00.000Z');
    expect(nflWeekOf('2026-09-09', new Date('2026-09-11T00:20:00Z'))).toBe(1);
    // Monday night of week 4 still belongs to week 4.
    expect(nflWeekOf('2026-09-09', new Date('2026-10-06T02:00:00Z'))).toBe(4);
    expect(nflWeekOf('2026-09-09', new Date('2026-10-07T00:00:00Z'))).toBe(5);
  });
});
