import { describe, expect, it } from 'vitest';
import { teamUrl } from '@/src/providers/links';
import { injuryLevel, issueSummary, lineupIssues, slotAccepts } from './lineup-check';
import type { League, RosterPlayer } from './models';

const pl = (id: string, slot: RosterPlayer['slot'], lineupSlot: string, position: string, injury: string | null = null): RosterPlayer => ({
  id,
  name: id,
  position,
  lineupSlot,
  slot,
  proTeam: null,
  injury,
});

describe('injury levels across providers', () => {
  it.each([
    ['Out', 'out'],
    ['IR', 'out'],
    ['INJURY RESERVE', 'out'],
    ['Injured Reserve', 'out'],
    ['O', 'out'],
    ['SUSPENSION', 'out'],
    ['Sus', 'out'],
    ['IL10', 'out'],
    ['Doubtful', 'doubtful'],
    ['D', 'doubtful'],
    ['QUESTIONABLE', 'questionable'],
    ['Q', 'questionable'],
    ['DAY_TO_DAY', 'questionable'],
    ['Day-to-Day', 'questionable'],
    ['Probable', null],
    ['ACTIVE', null],
    [null, null],
  ])('%s → %s', (raw, level) => {
    expect(injuryLevel(raw)).toBe(level);
  });
});

describe('slot eligibility', () => {
  it('knows flex slots per sport', () => {
    expect(slotAccepts('FLEX', 'TE', 'nfl')).toBe(true);
    expect(slotAccepts('FLEX', 'QB', 'nfl')).toBe(false);
    expect(slotAccepts('SUPER_FLEX', 'QB', 'nfl')).toBe(true);
    expect(slotAccepts('D/ST', 'DEF', 'nfl')).toBe(true);
    expect(slotAccepts('G', 'PG,SG', 'nba')).toBe(true);
    expect(slotAccepts('SG/SF', 'SF', 'nba')).toBe(true);
    expect(slotAccepts('UTIL', 'G', 'nhl')).toBe(false);
    expect(slotAccepts('UTIL', 'D', 'nhl')).toBe(true);
    expect(slotAccepts('D', 'D', 'nhl')).toBe(true);
    expect(slotAccepts('D/ST', 'D/ST', 'nfl')).toBe(true);
    expect(slotAccepts('OF', 'CF', 'mlb')).toBe(true);
    expect(slotAccepts('WR', null, 'nfl')).toBe(false);
  });
});

describe('lineup issues', () => {
  const roster = {
    teamId: 'a',
    emptySlots: ['FLEX'],
    players: [
      pl('qb', 'starter', 'QB', 'QB'),
      pl('wr1', 'starter', 'WR', 'WR', 'Out'),
      pl('te', 'starter', 'TE', 'TE', 'Questionable'),
      pl('wrB', 'bench', 'BN', 'WR'),
      pl('rbB', 'bench', 'BN', 'RB'),
      pl('hurtB', 'bench', 'BN', 'WR', 'Out'),
      pl('irWR', 'ir', 'IR', 'WR', 'IR'),
    ],
  };

  it('flags out and empty first, questionable after, with healthy eligible bench options', () => {
    const issues = lineupIssues(roster, 'nfl');
    expect(issues.map((i) => [i.severity, i.slot])).toEqual([
      ['bad', 'FLEX'],
      ['bad', 'WR'],
      ['warn', 'TE'],
    ]);
    expect(issues[0].options.map((p) => p.id)).toEqual(['wrB', 'rbB']);
    expect(issues[1].options.map((p) => p.id)).toEqual(['wrB']); // the hurt bench WR is never offered
    expect(issues[2].options).toEqual([]);
    expect(issues[1].message).toBe('wr1 is OUT');
  });

  it('summarises for a card', () => {
    expect(issueSummary(lineupIssues(roster, 'nfl'))).toEqual({ text: '2 LINEUP PROBLEMS', severity: 'bad' });
    expect(issueSummary([])).toBeNull();
    expect(issueSummary(lineupIssues({ teamId: 'b', players: [pl('x', 'starter', 'QB', 'QB', 'Q')] }, 'nfl'))).toEqual({
      text: '1 QUESTIONABLE STARTER',
      severity: 'warn',
    });
  });

  it('ignores injured players who are not starting', () => {
    expect(lineupIssues({ teamId: 'c', players: [pl('b', 'bench', 'BN', 'WR', 'Out'), pl('i', 'ir', 'IR', 'RB', 'IR')] }, 'nfl')).toEqual([]);
  });
});

describe('fix-it links', () => {
  const lg = (provider: League['provider'], id: string, sport: League['sport'] = 'nfl'): League => ({
    provider,
    id,
    name: 'x',
    sport,
    season: '2026',
    teamCount: null,
    myTeamId: null,
    scoring: null,
  });

  it('points at each provider’s team page', () => {
    expect(teamUrl(lg('sleeper', '99'), '3')).toBe('https://sleeper.com/leagues/99/team');
    expect(teamUrl(lg('yahoo', '461.l.12345'), '461.l.12345.t.3')).toBe('https://football.fantasysports.yahoo.com/f1/12345/3');
    expect(teamUrl(lg('yahoo', '465.l.777', 'nba'), null)).toBe('https://basketball.fantasysports.yahoo.com/nba/777');
    expect(teamUrl(lg('espn', '123', 'nhl'), '4')).toBe('https://fantasy.espn.com/hockey/team?leagueId=123&teamId=4&seasonId=2026');
    expect(teamUrl(lg('fleaflicker', '42'), '7')).toBe('https://www.fleaflicker.com/nfl/leagues/42/teams/7');
    expect(teamUrl(lg('fantrax', 'abc'), 't1')).toBe('https://www.fantrax.com/fantasy/league/abc/team/roster;teamId=t1');
    expect(teamUrl(lg('mfl', '23456'), '0004')).toBe('https://www.myfantasyleague.com/2026/home/23456');
  });
});
