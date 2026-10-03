import { describe, expect, it } from 'vitest';
import leagueScoreboard from './fixtures/leagueScoreboard.json';
import leagueStandings from './fixtures/leagueStandings.json';
import teamRoster from './fixtures/teamRoster.json';
import userLeagues from './fixtures/userLeagues.json';
import { toYahooLeagues, toYahooMatchups, toYahooRosters, toYahooTeams, YAHOO_API } from './adapter';
import { yahooAuthMessage } from './oauth';

/** Real recorded Yahoo responses — see fixtures/README.md. */
describe('yahoo parsers on real responses', () => {
  it('calls the API host, not the website', () => {
    expect(YAHOO_API).toBe('https://fantasysports.yahooapis.com/fantasy/v2');
  });

  it('lists leagues with sport, size and scoring', () => {
    const l = toYahooLeagues(userLeagues);
    expect(l.length).toBeGreaterThan(1);
    expect(l[0]).toMatchObject({ provider: 'yahoo', id: '328.l.24281', sport: 'mlb', season: '2014', teamCount: 13, scoring: 'Points' });
    expect(l[1].scoring).toBe('H2H Categories');
  });

  it('reads standings: names, managers, records, ranks', () => {
    const { teams } = toYahooTeams(leagueStandings);
    expect(teams).toHaveLength(12);
    expect(teams[0]).toMatchObject({ id: '328.l.34014.t.4', rank: 1, record: { wins: 134, losses: 73, ties: 13 } });
    expect(teams.every((t) => t.name && t.record)).toBe(true);
  });

  it('reads the scoreboard', () => {
    const { period, matchups } = toYahooMatchups(leagueScoreboard);
    expect(period).toBe(25);
    expect(matchups.length).toBeGreaterThan(0);
    expect(matchups[0].home.teamId).toMatch(/\.t\.\d+$/);
    expect(matchups[0].away?.points).not.toBeNull();
  });

  it('reads a roster with names, slots and multi-position players', () => {
    const team = (teamRoster as { fantasy_content: { team: unknown } }).fantasy_content.team;
    const [r] = toYahooRosters({ fantasy_content: { league: [{}, { teams: { 0: { team }, count: 1 } }] } });
    expect(r.players.length).toBe(20);
    expect(r.players[0]).toMatchObject({ name: 'Dioner Navarro', lineupSlot: 'C', slot: 'starter', proTeam: 'CLE' });
    expect(r.players.some((p) => p.slot === 'bench')).toBe(true);
  });
});

describe('yahoo sign-in errors', () => {
  it('keeps what Yahoo said and says what to do', () => {
    expect(yahooAuthMessage('invalid_grant', 'expired')).toMatch(/expired.*Codes work once/);
    expect(yahooAuthMessage('INVALID_CONSUMER_KEY', 'Client ID does not exist')).toMatch(/Client ID or Client Secret.*Client ID does not exist/);
    expect(yahooAuthMessage('redirect_uri_mismatch', '')).toContain('oob');
  });
});
