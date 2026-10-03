import { describe, expect, it } from 'vitest';
import props from './fixtures/nfl-props.json';
import scoreboard from './fixtures/nfl-scoreboard.json';
import {
  americanOdds,
  corePath,
  directBetLink,
  eventPage,
  gameState,
  gameForAbbr,
  gameForTeam,
  hasOdds,
  marketName,
  parseProps,
  parseScoreboard,
  payoutOn10,
} from './odds';

/** Fixtures: real ESPN responses from 2026 week 4, trimmed. */
describe('game odds (real ESPN scoreboard)', () => {
  const games = parseScoreboard(scoreboard);

  it('reads teams, the line and all three markets', () => {
    const g = games.find((x) => x.eventId === '401872965')!;
    expect(g).toMatchObject({ book: 'DraftKings', details: 'IND -4.5', home: { abbr: 'WSH' }, away: { abbr: 'IND' } });
    expect(g.moneyline?.home.odds).toBe('+170');
    expect(g.spread?.home.line).toBe('+4.5');
    expect(g.total?.over.line).toBe('o46.5');
    expect(hasOdds(g)).toBe(true);
  });

  it('turns ESPN tracking links into direct DraftKings bet links', () => {
    const g = games.find((x) => x.eventId === '401872965')!;
    expect(g.moneyline?.home.link).toMatch(/^https:\/\/sportsbook\.draftkings\.com\/event\/\d+\?outcomes=/);
    expect(g.moneyline?.home.link).not.toContain('__s__');
    expect(g.eventUrl).toMatch(/^https:\/\/sportsbook\.draftkings\.com\/event\/\d+$/);
  });

  it('keeps games without odds, marked as such', () => {
    expect(games.some((g) => !hasOdds(g))).toBe(true);
  });

  it('finds a team’s game by ESPN id or by any provider’s abbreviation', () => {
    expect(gameForTeam(games, '28')?.eventId).toBe('401872965');
    expect(gameForAbbr(games, 'WAS', 'nfl')?.eventId).toBe('401872965');
    expect(gameForAbbr(games, 'wsh', 'nfl')?.eventId).toBe('401872965');
    expect(gameForTeam(games, null)).toBeNull();
  });
});

describe('player lines (real ESPN props)', () => {
  const byPlayer = parseProps(props);
  const qb = byPlayer.get('2576980')!;

  it('collects main lines with opening lines', () => {
    const passing = qb.lines.find((l) => l.market === 'Passing Yards');
    expect(passing).toMatchObject({ line: 207.5, openLine: 209.5 });
    expect(qb.lines.map((l) => l.market)).toEqual(expect.arrayContaining(['Passing Touchdowns', 'Rushing Yards', 'Carries']));
  });

  it('drops milestone ladders and partial-game lines', () => {
    expect(qb.lines.some((l) => /Milestone|Half|Quarter/i.test(l.market))).toBe(false);
  });

  it('lists scorer markets separately', () => {
    const scorers = [...byPlayer.values()].flatMap((p) => p.scorer);
    expect(scorers).toContain('Anytime Touchdown Scorer');
  });
});

describe('odds helpers', () => {
  it('names markets', () => {
    expect(marketName('Total Receiving Yards (incl. overtime)')).toBe('Receiving Yards');
    expect(marketName('Total Passing Plus Rushing Yards (incl. overtime)')).toBe('Passing + Rushing Yards');
    expect(marketName('Receiving Yards Milestones')).toBeNull();
    expect(marketName('Total Points 1st Half')).toBeNull();
  });

  it('only passes sportsbook https links', () => {
    expect(directBetLink('https://evil.example.com/x')).toBeNull();
    expect(directBetLink('javascript:alert(1)')).toBeNull();
    expect(directBetLink('https://x.com/gw?preurl=https%3A%2F%2Fsportsbook.draftkings.com%2Fevent%2F1')).toBe('https://sportsbook.draftkings.com/event/1');
    expect(eventPage('https://sportsbook.draftkings.com/event/9?outcomes=1')).toBe('https://sportsbook.draftkings.com/event/9');
  });

  it('builds the props server path', () => {
    expect(corePath('nfl')).toBe('football/leagues/nfl');
    expect(corePath('nhl')).toBe('hockey/leagues/nhl');
  });

  it('formats odds and $10 payouts', () => {
    expect(americanOdds('170')).toBe('+170');
    expect(americanOdds('-110')).toBe('-110');
    expect(payoutOn10('+170')).toBe(27);
    expect(payoutOn10('-200')).toBe(15);
    expect(payoutOn10(null)).toBeNull();
  });
});

describe('game state beside a player', () => {
  const games = parseScoreboard(scoreboard);
  it('pre, final, bye and unknown', () => {
    expect(gameState(games, 'WAS', 'nfl').state).toBe('pre');
    expect(gameState(games, 'PIT', 'nfl').state).toBe('final');
    expect(gameState(games, 'ZZZ', 'nfl').state).toBe('bye');
    expect(gameState(games, 'ZZZ', 'nba').state).toBe('unknown');
    expect(gameState([], 'WAS', 'nfl').state).toBe('unknown');
    expect(gameState(games, null, 'nfl').state).toBe('unknown');
  });
});
