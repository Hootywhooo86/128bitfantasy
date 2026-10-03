import { describe, expect, it } from 'vitest';
import { espnPoints } from './espn/adapter';
import { toFleaRoster } from './fleaflicker/adapter';
import { toMflRosters } from './mfl/adapter';
import { toRoster } from './sleeper/adapter';
import { toYahooTeamRoster, yahooPointsPath } from './yahoo/adapter';

describe('live player points, per provider', () => {
  it('Sleeper: players_points covers starters and bench', () => {
    const r = toRoster(
      { roster_id: 1, owner_id: 'u', players: ['a', 'b'], starters: ['a'], reserve: null, taxi: null, settings: {} },
      ['QB', 'BN'],
      { a: { full_name: 'A' }, b: { full_name: 'B' } },
      { a: 21.1, b: 4 }
    );
    expect(r.players.map((p) => p.points)).toEqual([21.1, 4]);
    expect(toRoster({ roster_id: 1, owner_id: 'u', players: ['a'], starters: ['a'], reserve: null, taxi: null, settings: {} }, ['QB'], {}).players[0].points).toBeNull();
  });

  it('ESPN: actual points for the current scoring period only', () => {
    const p = {
      id: 1,
      fullName: 'X',
      defaultPositionId: 1,
      proTeamId: 1,
      stats: [
        { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 4, appliedTotal: 18.2 },
        { statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: 3, appliedTotal: 30 },
        { statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: 4, appliedTotal: 12.345 },
      ],
    };
    expect(espnPoints(p, 4)).toBe(12.35);
    expect(espnPoints(p, 5)).toBeNull();
  });

  it('Fleaflicker: viewingActualPoints on the league player', () => {
    const r = toFleaRoster('7', {
      groups: [{ group: 'START', slots: [{ position: { label: 'RB' }, leaguePlayer: { proPlayer: { id: 1, nameFull: 'R' }, viewingActualPoints: { value: 13.6 }, viewingProjectedPoints: { value: 11 } } }] }],
    });
    expect(r.players[0]).toMatchObject({ points: 13.6, projected: 11 });
  });

  it('MFL: live score for starters, none for the bench', () => {
    const r = toMflRosters(
      { rosters: { franchise: { id: '0001', player: [{ id: 'a', status: 'ROSTER' }, { id: 'b', status: 'ROSTER' }] } } },
      { liveScoring: { matchup: { franchise: { id: '0001', players: { player: { id: 'a', status: 'starter', score: '17.40' } } } } } },
      {},
      {}
    );
    expect(r[0].players.map((p) => p.points)).toEqual([17.4, null]);
  });

  it('Yahoo: player_points from a team stats request (shape from Yahoo docs via yfpy)', () => {
    const r = toYahooTeamRoster({
      fantasy_content: {
        team: [
          [{ team_key: '331.l.1.t.1' }],
          {
            roster: {
              0: {
                players: {
                  0: {
                    player: [
                      [{ player_key: '331.p.5228' }, { name: { full: 'Tom Brady' } }, { display_position: 'QB' }],
                      { selected_position: [{ coverage_type: 'week' }, { position: 'QB' }] },
                      { player_stats: { coverage_type: 'week', week: '1' }, player_points: { coverage_type: 'week', week: '1', total: 10.26 } },
                    ],
                  },
                  count: 1,
                },
              },
            },
          },
        ],
      },
    });
    expect(r?.players[0]).toMatchObject({ name: 'Tom Brady', slot: 'starter', points: 10.26 });
  });

  it('Yahoo: by week for the NFL, by date for daily sports', () => {
    expect(yahooPointsPath('461.l.1.t.2', 'nfl', 4)).toBe('team/461.l.1.t.2/roster;week=4/players/stats;type=week;week=4');
    expect(yahooPointsPath('465.l.1.t.2', 'nba', 3, new Date(2026, 10, 5))).toBe('team/465.l.1.t.2/roster;date=2026-11-05/players/stats;type=date;date=2026-11-05');
  });
});
