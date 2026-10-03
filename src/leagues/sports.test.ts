import { describe, expect, it } from 'vitest';
import mlbBox from './fixtures/mlb-boxscore.json';
import mlbHitting from './fixtures/mlb-hitting.json';
import mlbPitching from './fixtures/mlb-pitching.json';
import mlbTeams from './fixtures/mlb-teams.json';
import nbaPlayers from './fixtures/nba-players.json';
import nbaSeason from './fixtures/nba-season.json';
import nbaWeek from './fixtures/nba-week.json';
import { catValue, categoryDefs } from './categories';
import { auctionValues, draftRounds, draftState, maxBid, nextNominator, openSlots, pickKey, pickUsed, rankPool, teamPicks } from './draft';
import { abbrMap, buildMlbPool, mlbPosition, parseMlbBoxscore, parseMlbSchedule } from './mlb';
import { buildNbaPool, nbaPosition, parseNbaWeek, sleeperNbaWeek } from './nba';
import { fantasyPoints, MLB_SCORING, NBA_SCORING } from './scoring';
import { defaultSettings, settingsProblems } from './settings';
import { playoffSeeds, type TableRow } from './standings';
import { slotTakes, type DraftPick } from './types';

const abbr = abbrMap(mlbTeams);

describe('baseball (MLB Stats API)', () => {
  it('maps positions, pitchers by how often they start', () => {
    expect(['LF', 'CF', 'RF'].map((p) => mlbPosition(p))).toEqual(['OF', 'OF', 'OF']);
    expect(mlbPosition('P', { gamesStarted: 30, gamesPitched: 30 })).toBe('SP');
    expect(mlbPosition('P', { gamesStarted: 0, gamesPitched: 71 })).toBe('RP');
    expect(mlbPosition('P', { gamesStarted: 10, gamesPitched: 20 })).toBe('SP/RP');
    expect(mlbPosition('TWP')).toBe('DH/SP');
  });

  it('reads a box score into hitting and pitching lines', () => {
    const lines = parseMlbBoxscore(mlbBox, true);
    // Elly De La Cruz: 1-4, HR, 2 K, RBI, run.
    expect(lines.get('682829')).toMatchObject({ atBats: 4, hits: 1, homeRuns: 1, singles: 0, rbi: 1, runs: 1, strikeouts: 2 });
    expect(fantasyPoints(lines.get('682829')!, MLB_SCORING)).toBe(4 + 1 + 1 - 2);
    // Luis Mey: 1 IP, 0 ER, 1 K.
    expect(lines.get('682825')).toMatchObject({ outs: 3, earnedRuns: 0, pitcherStrikeouts: 1, qualityStarts: 0 });
    expect(fantasyPoints(lines.get('682825')!, MLB_SCORING)).toBe(3 + 1);
  });

  it('reads the schedule with team abbreviations', () => {
    const games = parseMlbSchedule(
      { dates: [{ games: [{ gamePk: 1, gameType: 'R', gameDate: 'x', status: { abstractGameState: 'Live' }, teams: { home: { team: { id: 113 } }, away: { team: { id: 119 } } } }] }] },
      abbr
    );
    expect(games).toEqual([{ id: '1', start: 'x', state: 'live', home: 'CIN', away: 'LAD' }]);
  });

  it('builds a pool from season stats, with two-way players as both', () => {
    const pool = buildMlbPool([], mlbHitting, mlbPitching, abbr);
    const ohtani = pool.find((p) => p.name === 'Shohei Ohtani')!;
    expect(ohtani.position).toBe('DH/SP');
    expect(ohtani.seasonLine.homeRuns).toBeGreaterThan(0);
    expect(ohtani.seasonLine.pitcherStrikeouts).toBeGreaterThan(0);
    expect(pool.find((p) => p.name === 'Louis Varland')!.position).toBe('RP');
    expect(pool.find((p) => p.name === 'Kyle Schwarber')!.seasonLine.homeRuns).toBe(45);
  });

  it('works out ERA, WHIP and AVG from totals', () => {
    const [avg, era, whip] = categoryDefs('mlb', ['avg', 'era', 'whip']);
    expect(catValue(avg, { hits: 30, atBats: 100 })).toBe(0.3);
    expect(catValue(era, { earnedRuns: 3, outs: 27 })).toBe(3);
    expect(catValue(whip, { hitsAllowed: 5, walksAllowed: 1, outs: 18 })).toBe(1);
  });
});

describe('basketball (Sleeper)', () => {
  it('reads per-game rows and skips games he did not play', () => {
    const rows = parseNbaWeek(nbaWeek);
    expect(rows.every((r) => r.playerId === '1658')).toBe(true);
    expect(rows.map((r) => [r.date, r.line.pts])).toEqual([
      ['2025-12-22', 14],
      ['2025-12-23', 29],
      ['2025-12-25', 56],
      ['2025-12-27', 34],
    ]);
    const l = rows[2].line;
    expect(fantasyPoints(l, NBA_SCORING)).toBeCloseTo(l.pts + 1.2 * l.reb + 1.5 * l.ast + 3 * (l.stl ?? 0) + 3 * (l.blk ?? 0) - (l.to ?? 0), 2);
  });

  it('builds a pool with every eligible position', () => {
    const pool = buildNbaPool(nbaPlayers, nbaSeason);
    expect(pool.find((p) => p.id === '1658')).toMatchObject({ name: 'Nikola Jokić', position: 'C', team: 'DEN' });
    expect(pool.find((p) => p.id === '1054')!.position).toBe('PG/SG');
    expect(pool.some((p) => p.id === '1875')).toBe(false); // no team
    expect(pool.find((p) => p.id === '1658')!.seasonLine.pts).toBe(1799);
    expect(nbaPosition({ position: 'G' })).toBe('PG/SG');
  });

  it("numbers Sleeper's weeks from opening Monday", () => {
    expect(sleeperNbaWeek('2025-10-21', new Date('2025-12-22T20:00:00Z'))).toBe(10);
    expect(sleeperNbaWeek('2025-10-21', new Date('2025-10-21T23:00:00Z'))).toBe(1);
  });
});

describe('positions per sport', () => {
  it('matches the database rules', () => {
    expect(slotTakes('G', 'PG/SG', 'nba')).toBe(true);
    expect(slotTakes('F', 'SF/PF', 'nba')).toBe(true);
    expect(slotTakes('F', 'C', 'nhl')).toBe(true);
    expect(slotTakes('G', 'PG', 'nhl')).toBe(false);
    expect(slotTakes('UTIL', 'SP', 'mlb')).toBe(false);
    expect(slotTakes('SP', 'DH/SP', 'mlb')).toBe(true);
    expect(slotTakes('UTIL', 'C', 'nba')).toBe(true);
  });

  it('fills a basketball lineup with multi-position players', () => {
    expect(openSlots({ PG: 1, SG: 1, G: 1 }, ['PG/SG', 'PG/SG', 'PG'], 'nba')).toEqual([]);
  });
});

describe('draft rounds, pick trades, auction', () => {
  const s = { slots: { C: 1, G: 1 }, bench: 2, keepers: 2, draftRounds: null as number | null };
  it('keepers shorten drafts after the first season', () => {
    expect(draftRounds(s, true)).toBe(4);
    expect(draftRounds(s, false)).toBe(2);
    expect(draftRounds({ ...s, draftRounds: 1 }, false)).toBe(1);
  });

  it('the clock follows a traded pick', () => {
    const owners = new Map([[pickKey('2026', 1, 'a'), 'b']]);
    const st = draftState(['a', 'b'], s, [], { season: '2026', owners });
    expect(st).toMatchObject({ onClock: 'b', via: 'a', round: 1, rounds: 4 });
    const pick: DraftPick = { leagueId: '', pickNo: 0, teamId: 'b', playerId: 'x', madeAt: '', auto: false };
    expect(draftState(['a', 'b'], s, [pick], { season: '2026', owners }).onClock).toBe('b');
    expect(teamPicks('b', ['a', 'b'], '2026', 2, owners)).toEqual(['2026:1:a', '2026:1:b', '2026:2:b']);
    expect(pickUsed('2026:1:b', ['a', 'b'], 'snake', 1)).toBe(false);
    expect(pickUsed('2026:1:a', ['a', 'b'], 'snake', 1)).toBe(true);
    // Snake: round 2 starts with b.
    expect(pickUsed('2026:2:b', ['a', 'b'], 'snake', 3)).toBe(true);
    expect(pickUsed('2026:2:a', ['a', 'b'], 'snake', 3)).toBe(false);
  });

  it('auction maths', () => {
    expect(maxBid(10, 2)).toBe(9);
    expect(maxBid(5, 1)).toBe(5);
    expect(maxBid(5, 0)).toBe(0);
    expect(nextNominator(['a', 'b', 'c'], 1, (t) => (t === 'b' ? 0 : 1))).toBe('c');
    const ranked = rankPool(
      [
        { id: 'x', name: 'x', position: 'C', team: 'T', seasonLine: { goals: 50 }, gamesPlayed: 1 },
        { id: 'y', name: 'y', position: 'C', team: 'T', seasonLine: { goals: 10 }, gamesPlayed: 1 },
      ],
      { goals: 1 }
    );
    const v = auctionValues(ranked, 1, 2, 200);
    expect(v.get('x')).toBeGreaterThan(v.get('y')!);
    expect(v.get('y')).toBe(1);
  });
});

describe('divisions', () => {
  const row = (teamId: string, rank: number): TableRow => ({ teamId, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, score: null, rank });
  it('division winners get the top seeds', () => {
    const table = ['a', 'b', 'c', 'd'].map((t, i) => row(t, i + 1));
    const div = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 0],
      ['d', 1],
    ]);
    expect(playoffSeeds(table, 4, div)).toEqual(['a', 'd', 'b', 'c']);
    expect(playoffSeeds(table, 2, div)).toEqual(['a', 'd']);
    expect(playoffSeeds(table, 2)).toEqual(['a', 'b']);
  });

  it('checks every new setting', () => {
    for (const sport of ['nhl', 'nfl', 'mlb', 'nba'] as const) expect(settingsProblems(sport, defaultSettings(sport), 10), sport).toEqual([]);
    const bad = { ...defaultSettings('nba'), divisions: ['East'], draftType: 'auction' as const, auctionBudget: 5 };
    expect(settingsProblems('nba', bad, 10)).toEqual(expect.arrayContaining(['Use 2 to 4 divisions, or none.', expect.stringMatching(/Auction budget/)]));
  });
});
