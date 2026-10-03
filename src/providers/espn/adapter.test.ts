import { describe, expect, it } from 'vitest';
import { toEspnLeague, toEspnMatchups, toEspnRosters, toEspnTeams } from './adapter';
import { espnCookie, espnLeagueUrl, espnSeason, type EspnLeague } from './client';

const raw: EspnLeague = {
  id: 123,
  seasonId: 2026,
  status: { currentMatchupPeriod: 4 },
  settings: { name: 'Office League', size: 2, scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] } },
  members: [{ id: '{ABC}', displayName: 'danny' }],
  teams: [
    {
      id: 1,
      location: 'Pixel',
      nickname: 'Whistles',
      owners: ['{abc}'],
      record: { overall: { wins: 3, losses: 1, ties: 0, pointsFor: 512.4, pointsAgainst: 470 } },
      playoffSeed: 1,
      roster: {
        entries: [
          { playerId: 1, lineupSlotId: 0, playerPoolEntry: { player: { id: 1, fullName: 'Josh Allen', defaultPositionId: 1, proTeamId: 2 } } },
          { playerId: 2, lineupSlotId: 20, injuryStatus: 'QUESTIONABLE', playerPoolEntry: { player: { id: 2, fullName: 'Bench Guy', defaultPositionId: 3, proTeamId: 12 } } },
          { playerId: 3, lineupSlotId: 21, injuryStatus: 'INJURY_RESERVE' },
        ],
      },
    },
    { id: 2, name: 'Team Two', owners: ['{XYZ}'], playoffSeed: 2 },
  ],
  schedule: [
    { id: 1, matchupPeriodId: 3, home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } },
    { id: 2, matchupPeriodId: 4, home: { teamId: 2, totalPoints: 10 }, away: { teamId: 1, totalPoints: 12.5 } },
  ],
};

describe('espn adapter', () => {
  it('builds the url with every view on the live host', () => {
    const u = espnLeagueUrl('nfl', 2026, '123');
    expect(u).toContain('lm-api-reads.fantasy.espn.com');
    expect(u).toContain('/ffl/seasons/2026/');
    expect(u).toContain('view=mRoster');
  });

  it('names seasons the way ESPN does', () => {
    expect(espnSeason('nfl', new Date(2027, 0, 10))).toBe(2026);
    expect(espnSeason('nba', new Date(2026, 9, 3))).toBe(2027);
    expect(espnSeason('mlb', new Date(2026, 9, 3))).toBe(2026);
  });

  it('wraps the SWID in braces for the cookie, and needs both', () => {
    expect(espnCookie('s2', 'ABC')).toBe('espn_s2=s2; SWID={ABC}');
    expect(espnCookie(null, 'ABC')).toBeNull();
  });

  it('finds my team by SWID regardless of case', () => {
    const l = toEspnLeague(raw, 'nfl', 'abc');
    expect(l.myTeamId).toBe('1');
    expect(l.scoring).toBe('PPR');
    expect(l.name).toBe('Office League');
  });

  it('joins location and nickname for older leagues', () => {
    const t = toEspnTeams(raw);
    expect(t[0].name).toBe('Pixel Whistles');
    expect(t[0].owner).toBe('danny');
    expect(t[1].record).toBeNull();
  });

  it('maps slots, positions, teams and injuries', () => {
    const [r] = toEspnRosters(raw, 'nfl');
    expect(r.players[0]).toMatchObject({ lineupSlot: 'QB', slot: 'starter', position: 'QB', proTeam: 'BUF', injury: null });
    expect(r.players[1]).toMatchObject({ slot: 'bench', injury: 'QUESTIONABLE', proTeam: 'KC' });
    expect(r.players[2]).toMatchObject({ slot: 'ir', name: '3', injury: 'INJURY RESERVE' });
  });

  it('takes only the current matchup period', () => {
    const { period, matchups } = toEspnMatchups(raw);
    expect(period).toBe(4);
    expect(matchups).toHaveLength(1);
    expect(matchups[0].away).toEqual({ teamId: '1', points: 12.5 });
  });
});
