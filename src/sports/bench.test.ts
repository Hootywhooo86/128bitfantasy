import { describe, expect, it } from 'vitest';
import { gameForAbbr, type GameOdds } from '@/src/betting/odds';
import { toEspnRosters } from '@/src/providers/espn/adapter';
import type { EspnLeague } from '@/src/providers/espn/client';
import { deriveEvents } from './events';
import { benchStarts } from './lineup-check';
import type { LeagueSnapshot, Roster, RosterPlayer } from './models';

const pl = (id: string, slot: RosterPlayer['slot'], lineupSlot: string, position: string, proTeam: string | null, injury: string | null = null): RosterPlayer => ({
  id,
  name: id,
  position,
  lineupSlot,
  slot,
  proTeam,
  injury,
});

const game = (id: string, away: string, home: string, status = 'STATUS_SCHEDULED', startsAt = '2026-10-07T23:30:00Z'): GameOdds => ({
  eventId: id,
  startsAt,
  status,
  book: 'x',
  home: { teamId: home, abbr: home, name: home },
  away: { teamId: away, abbr: away, name: away },
  details: null,
  spread: null,
  total: null,
  moneyline: null,
  eventUrl: null,
});

// Wednesday's slate from the Fantrax screenshot: PIT, EDM and WPG play; LAK, SEA, TOR, MIN don't.
const slate = [game('1', 'PIT', 'NYR'), game('2', 'EDM', 'CGY', 'STATUS_SCHEDULED', '2026-10-08T02:00:00Z'), game('3', 'WPG', 'DAL')];

const roster: Roster = {
  teamId: 'me',
  players: [
    pl('Clarke', 'starter', 'D', 'D', 'LAK'),
    pl('McCann', 'starter', 'C', 'C', 'SEA'),
    pl('Nylander', 'starter', 'RW', 'RW', 'TOR'),
    pl('Girard', 'starter', 'D', 'D', 'PIT'),
    pl('Wallstedt', 'starter', 'G', 'G', 'MIN'),
    pl('Kempe', 'starter', 'RW', 'RW', 'LAK'),
    pl('Hyman', 'bench', 'BN', 'RW', 'EDM'),
    pl('Skinner', 'bench', 'BN', 'G', 'WPG'),
    pl('Barzal', 'bench', 'BN', 'C', 'NYI'),
    pl('Robertson', 'bench', 'BN', 'LW', 'PIT'),
    pl('Bedard', 'ir', 'IR', 'C', 'CHI'),
  ],
};

describe('bench players who play while a starter sits', () => {
  it('pairs each playing bench player with a slot they fit', () => {
    const r = benchStarts(roster, 'nhl', slate);
    const pairs = r.map((b) => [b.player.id, b.slot, b.replaces?.id ?? null]);
    expect(pairs).toContainEqual(['Skinner', 'G', 'Wallstedt']);
    expect(pairs).toContainEqual(['Hyman', 'RW', 'Nylander']);
    // Robertson is a LW: no idle LW or F slot here, so no pairing.
    expect(pairs.map((p) => p[0])).not.toContain('Robertson');
    // Barzal's team isn't playing; he's never suggested.
    expect(pairs.map((p) => p[0])).not.toContain('Barzal');
    // Nobody is moved into a spot whose starter plays (Girard, PIT).
    expect(pairs.map((p) => p[2])).not.toContain('Girard');
  });

  it('fills empty slots and flex slots, specific slots first', () => {
    const r = benchStarts(
      { teamId: 'me', emptySlots: ['UTIL'], players: [pl('a', 'starter', 'LW', 'LW', 'LAK'), pl('b', 'bench', 'BN', 'LW', 'PIT')] },
      'nhl',
      slate
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ slot: 'LW', replaces: { id: 'a' } });
  });

  it('skips games already started, injured bench players, and unknown teams', () => {
    const started = [game('1', 'PIT', 'NYR', 'STATUS_IN_PROGRESS')];
    const r1 = benchStarts({ teamId: 'me', players: [pl('s', 'starter', 'LW', 'LW', 'LAK'), pl('b', 'bench', 'BN', 'LW', 'PIT')] }, 'nhl', started);
    expect(r1).toEqual([]);
    const r2 = benchStarts({ teamId: 'me', players: [pl('s', 'starter', 'LW', 'LW', 'LAK'), pl('b', 'bench', 'BN', 'LW', 'PIT', 'Out')] }, 'nhl', slate);
    expect(r2).toEqual([]);
    const r3 = benchStarts({ teamId: 'me', players: [pl('s', 'starter', 'LW', 'LW', null), pl('b', 'bench', 'BN', 'LW', 'PIT')] }, 'nhl', slate);
    expect(r3).toEqual([]);
    expect(benchStarts(roster, 'nhl', [])).toEqual([]);
  });

  it('football: a bye opens the spot, a team simply not listed does not exist', () => {
    const week = [game('9', 'BUF', 'MIA')];
    const r = benchStarts(
      { teamId: 'me', players: [pl('wr1', 'starter', 'WR', 'WR', 'KC'), pl('wr2', 'bench', 'BN', 'WR', 'BUF')] },
      'nfl',
      week
    );
    expect(r[0]).toMatchObject({ player: { id: 'wr2' }, slot: 'WR', why: 'wr1 is on a bye' });
  });

  it('basketball multi-position players fit G/F/UTIL slots', () => {
    const r = benchStarts(
      { teamId: 'me', players: [pl('s', 'starter', 'G', 'PG', 'LAL'), pl('b', 'bench', 'BN', 'SG,SF', 'GSW')] },
      'nba',
      [game('5', 'GS', 'BOS')]
    );
    expect(r[0]).toMatchObject({ player: { id: 'b' }, slot: 'G' });
  });
});

describe('the bench alert event', () => {
  const snap = (r: Roster): LeagueSnapshot =>
    ({
      league: { provider: 'fantrax', id: 'L', name: 'Puck Club', sport: 'nhl', season: '2026', myTeamId: 'me' },
      teams: [],
      rosters: [r],
      matchups: [],
      period: 1,
      fetchedAt: 0,
    }) as unknown as LeagueSnapshot;

  it('fires once per player per game, with a stable id', () => {
    const a = deriveEvents(null, snap(roster), 0, slate).filter((e) => e.type === 'lineup.bench');
    const b = deriveEvents(snap(roster), snap(roster), 1, slate).filter((e) => e.type === 'lineup.bench');
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.find((e) => e.id.endsWith(':Hyman'))?.title).toMatch(/^Bench: Hyman plays /);
    expect(a.find((e) => e.id.endsWith(':Hyman'))?.body).toContain('Nylander has no game');
  });

  it('says nothing without a scoreboard', () => {
    expect(deriveEvents(null, snap(roster), 0).filter((e) => e.type === 'lineup.bench')).toEqual([]);
  });
});

describe('team codes', () => {
  it('folds provider spellings into the scoreboard’s', () => {
    const g = [game('1', 'LA', 'NJ'), game('2', 'GS', 'NY'), game('3', 'CHW', 'ATH')];
    expect(gameForAbbr(g, 'LAK', 'nhl')?.eventId).toBe('1');
    expect(gameForAbbr(g, 'NJD', 'nhl')?.eventId).toBe('1');
    expect(gameForAbbr(g, 'GSW', 'nba')?.eventId).toBe('2');
    expect(gameForAbbr(g, 'NYK', 'nba')?.eventId).toBe('2');
    expect(gameForAbbr(g, 'CWS', 'mlb')?.eventId).toBe('3');
    expect(gameForAbbr(g, 'OAK', 'mlb')?.eventId).toBe('3');
  });

  it('ESPN rosters carry a pro team in every sport', () => {
    const raw = {
      scoringPeriodId: 1,
      teams: [
        {
          id: 1,
          roster: {
            entries: [{ playerId: 7, lineupSlotId: 0, playerPoolEntry: { player: { id: 7, fullName: 'Leon Draisaitl', defaultPositionId: 1, proTeamId: 6 } } }],
          },
        },
      ],
    } as unknown as EspnLeague;
    expect(toEspnRosters(raw, 'nhl')[0].players[0].proTeam).toBe('EDM');
  });
});
