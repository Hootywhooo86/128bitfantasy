import { describe, expect, it } from 'vitest';
import { parseWlt, toFantraxLeague, toFantraxLeagues, toFantraxMatchups, toFantraxRosters, toFantraxTeams } from './adapter';

const info = {
  leagueName: 'Keeper Krew',
  scoringSystem: { type: 'POINTS' },
  teamInfo: { t1: { id: 't1', name: 'One' }, t2: { id: 't2', name: 'Two' } },
  matchups: [
    { period: 3, matchupList: [{ away: { id: 't2' }, home: { id: 't1' } }] },
    { period: 4, matchupList: [{ away: { id: 't1' }, home: { id: 't2' } }] },
  ],
};

describe('fantrax adapter', () => {
  it('reads league info without inventing a sport-specific scoring label', () => {
    const l = toFantraxLeague('abc', info, { sport: 'nhl' });
    expect(l).toMatchObject({ name: 'Keeper Krew', teamCount: 2, sport: 'nhl', scoring: 'Points' });
  });

  it('lists leagues and drops sports it does not know', () => {
    const l = toFantraxLeagues({ leagues: [{ leagueId: 'x', leagueName: 'X', sport: 'NFL', teamId: 'tm' }, { leagueId: 'y', sport: 'PGA' }] });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: 'x', sport: 'nfl', myTeamId: 'tm' });
  });

  it('parses W-L-T', () => {
    expect(parseWlt('3-1-0')).toEqual({ wins: 3, losses: 1, ties: 0 });
    expect(parseWlt('2-2')).toEqual({ wins: 2, losses: 2, ties: 0 });
    expect(parseWlt('nope')).toBeNull();
  });

  it('builds teams from teamInfo even when standings are missing', () => {
    const t = toFantraxTeams(info, null);
    expect(t.map((x) => x.name).sort()).toEqual(['One', 'Two']);
    expect(t[0].record).toBeNull();
    expect(t[0].pointsFor).toBeNull();
  });

  it('maps roster statuses and names players from the catalog', () => {
    const { period, rosters } = toFantraxRosters(
      { period: 4, rosters: { t1: { teamName: 'One', rosterItems: [{ id: 'p1', position: 'C', status: 'ACTIVE' }, { id: 'p2', position: 'D', status: 'RESERVE' }, { id: 'p3', status: 'INJURED_RESERVE' }] } } },
      { p1: { name: 'Center Ice', team: 'EDM', position: 'C' } }
    );
    expect(period).toBe(4);
    expect(rosters[0].players.map((p) => p.slot)).toEqual(['starter', 'bench', 'ir']);
    expect(rosters[0].players[0]).toMatchObject({ name: 'Center Ice', proTeam: 'EDM' });
    expect(rosters[0].players[1].name).toBe('p2');
  });

  it('takes the current period from the schedule, with no invented scores', () => {
    const m = toFantraxMatchups(info, 4);
    expect(m).toEqual([{ period: 4, home: { teamId: 't2', points: null }, away: { teamId: 't1', points: null } }]);
    expect(toFantraxMatchups(info, null)).toEqual([]);
  });
});
