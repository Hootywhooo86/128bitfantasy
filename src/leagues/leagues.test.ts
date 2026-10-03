import { describe, expect, it } from 'vitest';
import box from './fixtures/nhl-boxscore.json';
import goalies from './fixtures/nhl-goalie-summary.json';
import realtime from './fixtures/nhl-skater-realtime.json';
import summary from './fixtures/nhl-skater-summary.json';
import sleeperWeek from './fixtures/sleeper-week-stats.json';
import { autoPick, draftState, openSlots, rankPool, rosterSize, snakeTeam } from './draft';
import { buildNflPool, parseSleeperWeek } from './nfl';
import { nhlPoolFromStats, nhlSeasonFor, parseNhlBoxscore, parseNhlGames, previousNhlSeason } from './nhl';
import { fantasyPoints, NFL_SCORING, NHL_SCORING } from './scoring';
import { roundRobin, slotAt, standings, teamWeek, weekOf, weekRange, type LineupMove } from './season';
import { NFL_SLOTS, NHL_SLOTS, type DraftPick, type PoolPlayer } from './types';

describe('NHL box score', () => {
  const g = parseNhlBoxscore(box);

  it('reads a finished game', () => {
    expect(g.state).toBe('final');
    expect(g.start).toBe('2026-04-14T23:00:00Z');
    // Both teams' skaters and the goalies who played.
    expect(g.lines.size).toBeGreaterThan(30);
  });

  it('scores a skater', () => {
    // M. Geekie: 1 G, 2 SOG, +1, 1 block.
    const l = g.lines.get('8479987')!;
    expect(l).toMatchObject({ goals: 1, assists: 0, shots: 2, plusMinus: 1, blockedShots: 1 });
    expect(fantasyPoints(l, NHL_SCORING)).toBe(3 + 0.8 + 0.5 + 0.4);
  });

  it('gives the winning goalie a shutout, and the backups nothing', () => {
    // Swayman: 21 saves, 0 GA, W, 60:00.
    expect(g.lines.get('8480280')).toEqual({ saves: 21, shotsAgainst: 21, goalsAgainst: 0, goalieMinutes: 60, wins: 1, shutouts: 1 });
    expect(fantasyPoints(g.lines.get('8480280')!, NHL_SCORING)).toBe(4 + 4.2 + 3);
    const goalieIds = [...g.lines.entries()].filter(([, l]) => 'saves' in l).map(([id]) => id);
    expect(goalieIds).toHaveLength(2);
  });

  it('does not call a shutout before the game is over', () => {
    const live = parseNhlBoxscore({ ...box, gameState: 'LIVE' });
    expect(live.lines.get('8480280')!.shutouts).toBe(0);
  });

  it('reads games from a schedule week, skipping preseason', () => {
    const games = parseNhlGames({
      gameWeek: [
        { games: [{ id: 1, gameType: 2, startTimeUTC: 'x', gameState: 'FUT', homeTeam: { abbrev: 'BUF' }, awayTeam: { abbrev: 'CHI' } }] },
        { games: [{ id: 2, gameType: 1, homeTeam: { abbrev: 'A' }, awayTeam: { abbrev: 'B' } }] },
      ],
    });
    expect(games).toEqual([{ id: '1', start: 'x', state: 'pre', home: 'BUF', away: 'CHI' }]);
  });

  it('numbers seasons the NHL way', () => {
    expect(nhlSeasonFor(new Date('2026-10-03'))).toBe('20262027');
    expect(nhlSeasonFor(new Date('2027-03-01'))).toBe('20262027');
    expect(previousNhlSeason('20262027')).toBe('20252026');
  });
});

describe('NHL draft pool', () => {
  const pool = nhlPoolFromStats(summary, realtime, goalies);

  it('carries last season with hits and blocks', () => {
    const mcd = pool.find((p) => p.id === '8478402')!;
    expect(mcd).toMatchObject({ name: 'Connor McDavid', position: 'C', team: 'EDM', gamesPlayed: 82 });
    expect(mcd.seasonLine.goals).toBe(48);
    expect(mcd.seasonLine.assists).toBe(90);
    expect(typeof mcd.seasonLine.hits).toBe('number');
  });

  it('maps wingers and goalies', () => {
    expect(pool.find((p) => p.name === 'Nikita Kucherov')!.position).toBe('RW');
    expect(pool.filter((p) => p.position === 'G')).toHaveLength(3);
  });
});

describe('NFL stats (Sleeper)', () => {
  const week = parseSleeperWeek(sleeperWeek);

  it('drops team-offense rows', () => {
    expect(week.has('TEAM_BUF')).toBe(false);
    expect(week.has('BUF')).toBe(true);
  });

  it("scores the same as Sleeper's own PPR points", () => {
    // Josh Allen, Jonathan Taylor, a WR, a kicker, and the Bills defense.
    for (const id of ['4984', '7021', '8698', '8259', 'BUF']) {
      const l = week.get(id)!;
      expect(fantasyPoints(l, NFL_SCORING), id).toBeCloseTo(l.pts_ppr, 2);
    }
  });

  it('builds a pool from the catalog, skipping free agents', () => {
    const pool = buildNflPool(
      {
        '4984': { full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
        BUF: { full_name: 'Buffalo Bills', position: 'DEF', team: 'BUF' },
        '1': { full_name: 'Free Agent', position: 'RB', team: null },
        '2': { full_name: 'A Lineman', position: 'OL', team: 'BUF' },
      },
      sleeperWeek
    );
    expect(pool.map((p) => p.name)).toEqual(['Josh Allen', 'Buffalo Bills D/ST']);
    expect(pool[0].seasonLine.pass_yd).toBe(253);
  });
});

const p = (id: string, position: string, goals = 0): PoolPlayer => ({ id, name: id, position, team: 'X', seasonLine: { goals }, gamesPlayed: 1 });

describe('draft', () => {
  it('snakes', () => {
    const order = ['a', 'b', 'c'];
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => snakeTeam(order, n))).toEqual(['a', 'b', 'c', 'c', 'b', 'a', 'a']);
  });

  it('knows whose turn it is and when it ends', () => {
    const settings = { slots: { C: 1 }, bench: 1 };
    const order = ['a', 'b'];
    const picks: DraftPick[] = [{ leagueId: 'l', pickNo: 0, teamId: 'a', playerId: 'x', madeAt: '', auto: false }];
    expect(draftState(order, settings, picks)).toMatchObject({ pickNo: 1, onClock: 'b', round: 1 });
    const done = [0, 1, 2, 3].map((n) => ({ ...picks[0], pickNo: n, playerId: `p${n}` }));
    expect(draftState(order, settings, done).onClock).toBeNull();
    expect(rosterSize({ slots: NHL_SLOTS, bench: 4 })).toBe(17);
  });

  it('fills exact slots before UTIL', () => {
    expect(openSlots({ C: 1, UTIL: 1 }, ['C'])).toEqual(['UTIL']);
    expect(openSlots({ C: 1, UTIL: 1 }, ['C', 'C'])).toEqual([]);
    expect(openSlots(NFL_SLOTS, ['RB', 'RB', 'RB'])).not.toContain('FLEX');
  });

  it('auto-picks the best player who fills a need', () => {
    const ranked = rankPool([p('c1', 'C', 50), p('c2', 'C', 40), p('d1', 'D', 10), p('g1', 'G', 1)], NHL_SCORING);
    const settings = { slots: { C: 1, D: 1, G: 1 }, bench: 0 };
    // Already has a C: skips the better C for the D.
    expect(autoPick(ranked, new Set(), [p('cx', 'C')], settings, 2)!.id).toBe('d1');
    expect(autoPick(ranked, new Set(['c1']), [], settings, 1)!.id).toBe('c2');
  });

  it('leaves kickers and defenses for the end', () => {
    const ranked = rankPool(
      [
        { ...p('k', 'K'), seasonLine: { xpm: 200 } },
        { ...p('rb', 'RB'), seasonLine: { rush_yd: 1000 } },
      ],
      NFL_SCORING
    );
    const settings = { slots: { RB: 1, K: 1 }, bench: 1 };
    expect(autoPick(ranked, new Set(), [], settings, 1)!.id).toBe('rb');
    // Last pick and the K slot is still open: must take the kicker.
    expect(autoPick(ranked, new Set(['rb']), [p('rb', 'RB'), p('rb2', 'RB')], settings, 3)!.id).toBe('k');
  });
});

describe('season', () => {
  it('plays everyone once per cycle, with a bye for odd counts', () => {
    const m = roundRobin(['a', 'b', 'c', 'd'], 3);
    expect(m).toHaveLength(6);
    const pairs = new Set(m.map((x) => [x.home, x.away].sort().join('')));
    expect(pairs.size).toBe(6);
    const odd = roundRobin(['a', 'b', 'c'], 3);
    expect(odd.filter((x) => x.away === null)).toHaveLength(3);
    for (let w = 1; w <= 3; w++) expect(odd.filter((x) => x.week === w)).toHaveLength(2);
  });

  it('counts a game only if the player started when it began', () => {
    const log: LineupMove[] = [
      { teamId: 't', playerId: 'p', slot: 'BN', at: '2026-10-10T00:00:00Z' },
      { teamId: 't', playerId: 'p', slot: 'C', at: '2026-10-11T00:00:00Z' },
    ];
    expect(slotAt(log, 't', 'p', '2026-10-10T23:00:00Z')).toBe('BN');
    expect(slotAt(log, 't', 'p', '2026-10-11T23:00:00Z')).toBe('C');
    expect(slotAt(log, 't', 'p', '2026-10-09T23:00:00Z')).toBeNull();
    const week = teamWeek(
      't',
      log,
      [
        { playerId: 'p', start: '2026-10-10T23:00:00Z', line: { goals: 2 } },
        { playerId: 'p', start: '2026-10-11T23:00:00Z', line: { goals: 1 } },
      ],
      NHL_SCORING
    );
    expect(week.total).toBe(3);
    expect(week.players).toEqual([{ playerId: 'p', points: 3, games: 1 }]);
  });

  it('ranks by record, then points', () => {
    const rows = standings(
      ['a', 'b', 'c'],
      [
        { week: 1, home: 'a', away: 'b', homePts: 10, awayPts: 5 },
        { week: 1, home: 'c', away: null, homePts: 50, awayPts: null },
        { week: 2, home: 'b', away: 'c', homePts: 9, awayPts: 9 },
      ]
    );
    expect(rows.map((r) => [r.teamId, r.wins, r.losses, r.ties])).toEqual([
      ['a', 1, 0, 0],
      ['c', 0, 0, 1],
      ['b', 0, 1, 1],
    ]);
    expect(rows[1].pointsFor).toBe(59);
  });

  it('runs hockey weeks Monday to Sunday', () => {
    // 2026-10-07 is a Wednesday.
    const w1 = weekRange('2026-10-07T23:00:00Z', 1);
    expect(w1.from.toISOString()).toBe('2026-10-05T08:00:00.000Z');
    expect(weekRange('2026-10-07T23:00:00Z', 2).from.toISOString()).toBe('2026-10-12T08:00:00.000Z');
    expect(weekOf('2026-10-07T23:00:00Z', new Date('2026-10-13T02:00:00Z'))).toBe(2);
    // Sunday 10pm Pacific is Monday 05:00 UTC — still the Sunday's week.
    expect(weekOf('2026-10-07T23:00:00Z', new Date('2026-10-12T05:00:00Z'))).toBe(1);
  });
});
