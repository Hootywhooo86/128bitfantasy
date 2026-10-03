import { describe, expect, it } from 'vitest';
import { toYahooLeagues, toYahooMatchups, toYahooRosters, toYahooTeams, yList, yMerge } from './adapter';
import { parseTokenResponse, yahooAuthorizeUrl } from './oauth';

/** Shapes follow Yahoo's ?format=json: XML turned into arrays and "0"-keyed objects. */
const teamMeta = (key: string, name: string, mine = false) => [
  { team_key: key },
  { team_id: key.split('.').pop() },
  { name },
  mine ? { is_owned_by_current_login: 1 } : [],
  { managers: [{ manager: { nickname: `${name}-mgr` } }] },
];

describe('yahoo json helpers', () => {
  it('unwraps numbered lists and merged arrays', () => {
    expect(yList({ 0: 'a', 1: 'b', count: 2 })).toEqual(['a', 'b']);
    expect(yMerge([{ a: 1 }, [{ b: 2 }], { c: 3 }])).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe('yahoo adapter', () => {
  it('lists leagues across games', () => {
    const raw = {
      fantasy_content: {
        users: {
          0: {
            user: [
              { guid: 'G' },
              {
                games: {
                  0: {
                    game: [
                      { game_key: '461', code: 'nfl', season: '2026' },
                      { leagues: { 0: { league: [{ league_key: '461.l.1', name: 'Yahoo Bowl', num_teams: 10, scoring_type: 'head', season: '2026' }] }, count: 1 } },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 1,
        },
      },
    };
    expect(toYahooLeagues(raw)).toEqual([
      { provider: 'yahoo', id: '461.l.1', name: 'Yahoo Bowl', sport: 'nfl', season: '2026', teamCount: 10, myTeamId: null, scoring: 'H2H Categories' },
    ]);
  });

  it('reads standings and spots my team', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '461.l.1' },
          {
            standings: [
              {
                teams: {
                  0: { team: [teamMeta('461.l.1.t.1', 'Alpha', true), { team_points: { total: '512.3' } }, { team_standings: { rank: '1', outcome_totals: { wins: '3', losses: '1', ties: 0 }, points_for: '512.3', points_against: '400' } }] },
                  1: { team: [teamMeta('461.l.1.t.2', 'Beta'), { team_standings: { rank: '2', outcome_totals: { wins: 1, losses: 3, ties: 0 } } }] },
                  count: 2,
                },
              },
            ],
          },
        ],
      },
    };
    const { teams, myTeamId } = toYahooTeams(raw);
    expect(myTeamId).toBe('461.l.1.t.1');
    expect(teams[0]).toMatchObject({ name: 'Alpha', owner: 'Alpha-mgr', pointsFor: 512.3, rank: 1, record: { wins: 3, losses: 1, ties: 0 } });
  });

  it('reads every roster with its lineup slot', () => {
    const raw = {
      fantasy_content: {
        league: [
          {},
          {
            teams: {
              0: {
                team: [
                  teamMeta('t1', 'Alpha'),
                  {
                    roster: {
                      0: {
                        players: {
                          0: { player: [[{ player_key: 'p1' }, { name: { full: 'Jalen Hurts' } }, { editorial_team_abbr: 'Phi' }, { display_position: 'QB' }], { selected_position: [{ coverage_type: 'week' }, { position: 'QB' }] }] },
                          1: { player: [[{ player_key: 'p2' }, { name: { full: 'Hurt Guy' } }, { status: 'O' }, { status_full: 'Out' }, { display_position: 'WR' }], { selected_position: [{ position: 'IR' }] }] },
                          2: { player: [[{ player_key: 'p3' }, { name: { full: 'Bench Guy' } }], { selected_position: [{ position: 'BN' }] }] },
                          count: 3,
                        },
                      },
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
    };
    const [r] = toYahooRosters(raw);
    expect(r.teamId).toBe('t1');
    expect(r.players.map((p) => p.slot)).toEqual(['starter', 'ir', 'bench']);
    expect(r.players[0]).toMatchObject({ name: 'Jalen Hurts', proTeam: 'PHI', lineupSlot: 'QB' });
    expect(r.players[1].injury).toBe('Out');
  });

  it('reads the scoreboard', () => {
    const raw = {
      fantasy_content: {
        league: [
          {},
          {
            scoreboard: {
              0: {
                matchups: {
                  0: {
                    matchup: {
                      week: '4',
                      0: {
                        teams: {
                          0: { team: [teamMeta('t1', 'A'), { team_points: { total: '101.5' } }] },
                          1: { team: [teamMeta('t2', 'B'), { team_points: { total: '99' } }] },
                          count: 2,
                        },
                      },
                    },
                  },
                  count: 1,
                },
              },
              week: 4,
            },
          },
        ],
      },
    };
    const { period, matchups } = toYahooMatchups(raw);
    expect(period).toBe(4);
    expect(matchups).toEqual([{ period: 4, home: { teamId: 't1', points: 101.5 }, away: { teamId: 't2', points: 99 } }]);
  });
});

describe('yahoo oauth', () => {
  it('uses the out-of-band redirect', () => {
    const u = yahooAuthorizeUrl(' abc ');
    expect(u).toContain('client_id=abc');
    expect(u).toContain('redirect_uri=oob');
    expect(u).toContain('response_type=code');
  });

  it('expires a minute early and keeps the old refresh token if none comes back', () => {
    const t = parseTokenResponse({ access_token: 'a', expires_in: 3600 }, 0, 'old');
    expect(t).toEqual({ accessToken: 'a', refreshToken: 'old', expiresAt: 3_540_000 });
    expect(() => parseTokenResponse({}, 0)).toThrow();
  });
});
