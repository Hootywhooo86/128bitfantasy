import { describe, expect, it } from 'vitest';
import { catValue, categoryDefs, h2hCats, rotoPoints } from './categories';
import { snakeTeam } from './draft';
import { defaultSettings, lastWeek, settingsProblems, withDefaults } from './settings';
import { champion, leagueTable, matchupsForWeek, playoffPairs, type WeekRow } from './standings';
import type { HostedMatchup, LeagueSettings } from './types';

const nhl = (over: Partial<LeagueSettings>): LeagueSettings => ({ ...defaultSettings('nhl'), ...over });
const row = (week: number, teamId: string, points: number, line = {}): WeekRow => ({ week, teamId, points, line });

describe('categories', () => {
  const defs = categoryDefs('nhl', ['goals', 'gaa', 'savePct']);

  it('works out ratios from totals', () => {
    expect(catValue(defs[1], { goalsAgainst: 4, goalieMinutes: 120 })).toBe(2);
    expect(catValue(defs[2], { saves: 45, shotsAgainst: 50 })).toBe(0.9);
    expect(catValue(defs[1], {})).toBeNull();
  });

  it('lower GAA wins, and no goalie loses the ratio cats', () => {
    const m = h2hCats(defs, { goals: 5, goalsAgainst: 2, goalieMinutes: 60, saves: 28, shotsAgainst: 30 }, { goals: 5, goalsAgainst: 1, goalieMinutes: 60, saves: 29, shotsAgainst: 30 });
    expect([m.wins, m.losses, m.ties]).toEqual([0, 2, 1]);
    expect(h2hCats(defs, { goals: 1 }, { goals: 0, goalsAgainst: 1, goalieMinutes: 60, saves: 1, shotsAgainst: 2 }).losses).toBe(2);
  });

  it('roto: best gets N, ties share', () => {
    const r = rotoPoints(categoryDefs('nhl', ['goals']), new Map([['a', { goals: 9 }], ['b', { goals: 5 }], ['c', { goals: 5 }]]));
    expect(r.get('a')!.total).toBe(3);
    expect(r.get('b')!.total).toBe(1.5);
  });
});

const schedule: HostedMatchup[] = [
  { leagueId: '', week: 1, home: 'a', away: 'b' },
  { leagueId: '', week: 1, home: 'c', away: 'd' },
  { leagueId: '', week: 2, home: 'a', away: 'c' },
  { leagueId: '', week: 2, home: 'b', away: 'd' },
];
const teams = ['a', 'b', 'c', 'd'];
const weeks: WeekRow[] = [
  row(1, 'a', 100, { goals: 10, assists: 1 }),
  row(1, 'b', 90, { goals: 2, assists: 9 }),
  row(1, 'c', 80, { goals: 5, assists: 5 }),
  row(1, 'd', 70, { goals: 6, assists: 6 }),
  row(2, 'a', 50, { goals: 1, assists: 1 }),
  row(2, 'b', 95, { goals: 3, assists: 3 }),
  row(2, 'c', 60, { goals: 4, assists: 4 }),
  row(2, 'd', 99, { goals: 2, assists: 2 }),
];

describe('standings by format', () => {
  it('head-to-head points', () => {
    const t = leagueTable('nhl', nhl({ format: 'h2h_points', weeks: 2 }), teams, schedule, weeks);
    // Week 1: a beats b, c beats d. Week 2: c beats a (60-50), d beats b (99-95).
    // d and a are both 1-1; d has more points (169 to 150).
    expect(t.map((r) => [r.teamId, r.wins, r.losses])).toEqual([
      ['c', 2, 0],
      ['d', 1, 1],
      ['a', 1, 1],
      ['b', 0, 2],
    ]);
  });

  it('head-to-head categories counts every category', () => {
    const s = nhl({ format: 'h2h_cats', weeks: 2, categories: ['goals', 'assists'] });
    const t = leagueTable('nhl', s, teams, schedule, weeks);
    const a = t.find((r) => r.teamId === 'a')!;
    // Week 1 vs b: goals W, assists L. Week 2 vs c: both L.
    expect([a.wins, a.losses, a.ties]).toEqual([1, 3, 0]);
  });

  it('most categories gives one result per week', () => {
    const s = nhl({ format: 'h2h_most_cats', weeks: 2, categories: ['goals', 'assists'] });
    const a = leagueTable('nhl', s, teams, schedule, weeks).find((r) => r.teamId === 'a')!;
    // Week 1 split 1-1 → tie; week 2 loss.
    expect([a.wins, a.losses, a.ties]).toEqual([0, 1, 1]);
  });

  it('total points ranks by the season total', () => {
    const t = leagueTable('nhl', nhl({ format: 'points', weeks: 2 }), teams, [], weeks);
    expect(t.map((r) => r.teamId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('roto ranks season totals per category', () => {
    const t = leagueTable('nhl', nhl({ format: 'roto', weeks: 2, categories: ['goals', 'assists'] }), teams, [], weeks);
    // Goals: a 11, c 9, d 8, b 5. Assists: b 12, c 9, d 8, a 2.
    expect(t[0]).toMatchObject({ teamId: 'c', score: 6 });
  });
});

describe('playoffs', () => {
  it('pads the bracket with byes for the top seeds', () => {
    const six = ['s1', 's2', 's3', 's4', 's5', 's6'];
    expect(playoffPairs(six, 1, () => null, 10)).toEqual([
      ['s1', null],
      ['s4', 's5'],
      ['s2', null],
      ['s3', 's6'],
    ]);
    const r2 = playoffPairs(six, 2, (_w, a) => a, 10);
    expect(r2).toEqual([
      ['s1', 's4'],
      ['s2', 's3'],
    ]);
  });

  it('plays out after the regular season and crowns a champion', () => {
    const s = nhl({ format: 'h2h_points', weeks: 2, playoffTeams: 2 });
    expect(lastWeek(s, 4)).toBe(3);
    const final = matchupsForWeek('nhl', s, teams, schedule, weeks, 3);
    // Seeds: c (2-0), d (1-1, more points than a).
    expect(final).toEqual([{ leagueId: '', week: 3, home: 'c', away: 'd' }]);
    expect(champion('nhl', s, teams, schedule, weeks)).toBeNull();
    expect(champion('nhl', s, teams, schedule, [...weeks, row(3, 'c', 10), row(3, 'd', 20)])).toBe('d');
    // A tied final goes to the higher seed.
    expect(champion('nhl', s, teams, schedule, [...weeks, row(3, 'c', 15), row(3, 'd', 15)])).toBe('c');
  });

  it('waits for every regular week before seeding', () => {
    const s = nhl({ format: 'h2h_points', weeks: 2, playoffTeams: 2 });
    expect(matchupsForWeek('nhl', s, teams, schedule, weeks.filter((w) => w.week === 1), 3)).toEqual([]);
  });

  it('season-long formats have no matchups and crown the leader', () => {
    const s = nhl({ format: 'points', weeks: 2 });
    expect(matchupsForWeek('nhl', s, teams, schedule, weeks, 1)).toEqual([]);
    expect(champion('nhl', s, teams, [], weeks)).toBe('b');
  });
});

describe('settings', () => {
  it('fills in anything an older league is missing', () => {
    const s = withDefaults('nhl', { slots: { C: 1, G: 1 }, bench: 2, scoring: {}, pickSeconds: 60, weeks: 10 } as Partial<LeagueSettings>);
    expect(s).toMatchObject({ format: 'h2h_points', ir: 0, playoffTeams: 0, draftType: 'snake', waivers: { type: 'rolling' } });
    expect(s.slots).toEqual({ C: 1, G: 1 });
  });

  it('flags impossible leagues', () => {
    expect(settingsProblems('nhl', defaultSettings('nhl'), 10)).toEqual([]);
    expect(settingsProblems('nhl', nhl({ slots: { C: 2 } }), 10)).toContain('Hockey lineups need at least one G.');
    expect(settingsProblems('nhl', nhl({ playoffTeams: 8 }), 6)[0]).toMatch(/Playoffs can't have more teams/);
    expect(settingsProblems('nhl', nhl({ format: 'roto', categories: ['goals'] }), 6)).toContain('Pick at least 3 categories.');
  });

  it('linear drafts never reverse', () => {
    expect([0, 1, 2, 3].map((n) => snakeTeam(['a', 'b'], n, 'linear'))).toEqual(['a', 'b', 'a', 'b']);
  });
});
