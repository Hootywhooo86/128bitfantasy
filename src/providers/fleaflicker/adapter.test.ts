import { describe, expect, it } from 'vitest';
import { pick, toFleaLeagues, toFleaMatchups, toFleaRoster, toFleaTeams } from './adapter';

describe('fleaflicker adapter', () => {
  it('reads camelCase and snake_case alike', () => {
    expect(pick({ ownedTeam: 1 }, 'ownedTeam')).toBe(1);
    expect(pick({ owned_team: 2 }, 'ownedTeam')).toBe(2);
  });

  it('lists leagues with my team', () => {
    const [l] = toFleaLeagues({ leagues: [{ id: 42, name: 'Flea League', size: 12, ownedTeam: { id: 7, name: 'Mine' } }] }, 'nfl');
    expect(l).toMatchObject({ id: '42', name: 'Flea League', teamCount: 12, myTeamId: '7', provider: 'fleaflicker' });
  });

  it('flattens divisions into ranked teams', () => {
    const t = toFleaTeams({
      divisions: [
        { teams: [{ id: 1, name: 'A', recordOverall: { wins: 1, losses: 2 }, pointsFor: { value: 300 } }] },
        { teams: [{ id: 2, name: 'B', recordOverall: { wins: 2, losses: 1 }, pointsFor: { value: 280 }, owners: [{ displayName: 'bo' }] }] },
      ],
    });
    expect(t.map((x) => x.id)).toEqual(['2', '1']);
    expect(t[0]).toMatchObject({ rank: 1, owner: 'bo', pointsFor: 280 });
  });

  it('reads roster groups into slots', () => {
    const r = toFleaRoster('7', {
      groups: [
        { group: 'START', slots: [{ position: { label: 'RB' }, leaguePlayer: { proPlayer: { id: 9, nameFull: 'Run Back', position: 'RB', proTeamAbbreviation: 'DET', injury: { typeFull: 'Questionable' } } } }, { position: { label: 'WR' } }] },
        { group: 'BENCH', slots: [{ leaguePlayer: { proPlayer: { id: 10, nameFull: 'Sits', position: 'WR' } } }] },
        { group: 'INJURED', slots: [{ position: { label: 'IR' }, leaguePlayer: { proPlayer: { id: 11, nameFull: 'Hurt' } } }] },
      ],
    });
    expect(r.players).toHaveLength(3); // the empty WR slot is skipped
    expect(r.players[0]).toMatchObject({ slot: 'starter', lineupSlot: 'RB', proTeam: 'DET', injury: 'Questionable' });
    expect(r.players[1]).toMatchObject({ slot: 'bench', lineupSlot: 'BN' });
    expect(r.players[2]).toMatchObject({ slot: 'ir' });
  });

  it('reads scoreboard games', () => {
    const { period, matchups } = toFleaMatchups({
      schedulePeriod: { value: 4 },
      games: [{ home: { id: 1 }, away: { id: 2 }, homeScore: { score: { value: 88.5 } }, awayScore: { score: { value: 91 } } }],
    });
    expect(period).toBe(4);
    expect(matchups[0]).toEqual({ period: 4, home: { teamId: '1', points: 88.5 }, away: { teamId: '2', points: 91 } });
  });
});
