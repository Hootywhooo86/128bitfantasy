import { describe, expect, it } from 'vitest';
import { currentWeek, scoringLabel, toLeague, toMatchups, toRoster, toTeams } from './adapter';
import type { SleeperLeague, SleeperRoster } from './client';

const league: SleeperLeague = {
  league_id: '99',
  name: 'Dynasty Degens',
  sport: 'nfl',
  season: '2026',
  status: 'in_season',
  total_rosters: 2,
  roster_positions: ['QB', 'WR', 'FLEX', 'BN', 'BN', 'IR'],
  scoring_settings: { rec: 0.5 },
};

const rosters: SleeperRoster[] = [
  {
    roster_id: 1,
    owner_id: 'u1',
    players: ['4046', '6794', '0KC', '7564', '9999'],
    starters: ['4046', '6794', '0'],
    reserve: ['9999'],
    taxi: null,
    settings: { wins: 3, losses: 1, fpts: 480, fpts_decimal: 52 },
  },
  {
    roster_id: 2,
    owner_id: 'u2',
    players: [],
    starters: [],
    reserve: null,
    taxi: null,
    settings: { wins: 1, losses: 3, fpts: 400 },
  },
];

describe('sleeper adapter', () => {
  it('labels half-PPR and finds my roster', () => {
    expect(scoringLabel(league)).toBe('Half PPR');
    const l = toLeague(league, 'u2', rosters);
    expect(l.myTeamId).toBe('2');
    expect(l.provider).toBe('sleeper');
  });

  it('prefers the custom team name and joins the split points', () => {
    const teams = toTeams(rosters, [
      { user_id: 'u1', display_name: 'dan', metadata: { team_name: 'Whistle Blowers' } },
      { user_id: 'u2', display_name: 'sam', metadata: null },
    ]);
    expect(teams[0].name).toBe('Whistle Blowers');
    expect(teams[0].pointsFor).toBeCloseTo(480.52);
    expect(teams[0].rank).toBe(1);
    expect(teams[1].name).toBe('sam');
  });

  it('maps starters to slots, skips empty slots, and sorts the rest', () => {
    const r = toRoster(rosters[0], league.roster_positions!, {
      '4046': { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', injury_status: null },
      '6794': { full_name: 'Justin Jefferson', position: 'WR', team: 'MIN', injury_status: 'Questionable' },
      '9999': { first_name: 'Hurt', last_name: 'Guy', position: 'RB', team: 'NYJ' },
    });
    const by = Object.fromEntries(r.players.map((p) => [p.id, p]));
    expect(by['4046']).toMatchObject({ slot: 'starter', lineupSlot: 'QB', name: 'Patrick Mahomes' });
    expect(by['6794']).toMatchObject({ slot: 'starter', lineupSlot: 'WR', injury: 'Questionable' });
    expect(by['9999']).toMatchObject({ slot: 'ir', name: 'Hurt Guy' });
    // Unknown to the catalog: shows its id rather than vanishing.
    expect(by['7564']).toMatchObject({ slot: 'bench', name: '7564' });
    expect(r.players.some((p) => p.id === '0')).toBe(false);
  });

  it('pairs matchups and keeps byes', () => {
    const m = toMatchups(
      [
        { roster_id: 1, matchup_id: 1, points: 101.2 },
        { roster_id: 2, matchup_id: 1, points: 99 },
        { roster_id: 3, matchup_id: null, points: 0 },
      ],
      4
    );
    expect(m).toHaveLength(2);
    expect(m.find((x) => x.away)?.away?.teamId).toBe('2');
    expect(m.find((x) => !x.away)?.home.teamId).toBe('3');
  });

  it('has no week in the offseason', () => {
    expect(currentWeek({ week: 0, season: '2026', season_type: 'off' })).toBeNull();
    expect(currentWeek({ week: 0, season: '2026', season_type: 'pre' })).toBe(1);
    expect(currentWeek({ week: 4, display_week: 5, season: '2026', season_type: 'regular' })).toBe(5);
  });
});
