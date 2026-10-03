import { describe, expect, it } from 'vitest';
import fixture from './fixtures/league-23456.json';
import {
  assertMfl,
  exportUrl,
  list,
  mflName,
  mflSeason,
  toMflInjuries,
  toMflLeague,
  toMflMatchups,
  toMflPlayers,
  toMflRosters,
  toMflTeams,
} from './adapter';

/** Trimmed from a real public 2026 league (23456). */
const { league, rosters, standings, live, players } = fixture as Record<string, unknown>;

describe('mfl adapter (real 2026 league)', () => {
  it('reads the league and keeps the franchise number given', () => {
    const l = toMflLeague(league, '2026', '0004');
    expect(l).toMatchObject({ provider: 'mfl', id: '23456', sport: 'nfl', teamCount: 4, myTeamId: '0004', scoring: 'H2H Points' });
    expect(l.name.length).toBeGreaterThan(0);
  });

  it('names franchises and ranks them in MFL standings order', () => {
    const t = toMflTeams(league, standings);
    expect(t).toHaveLength(4);
    expect(t.every((x) => x.name && x.record && x.pointsFor != null)).toBe(true);
    expect(t.map((x) => x.rank).sort()).toEqual([1, 2, 3, 4]);
  });

  it('turns "Last, First" into "First Last" for every rostered player', () => {
    const cat = toMflPlayers(players);
    const r = toMflRosters(rosters, live, cat, {});
    expect(r).toHaveLength(4);
    const named = r.flatMap((x) => x.players).filter((p) => p.name !== p.id);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((p) => !p.name.includes(', '))).toBe(true);
  });

  it('reads this week from live scoring', () => {
    const { period, matchups } = toMflMatchups(live);
    expect(period).toBe(4);
    expect(matchups.length).toBeGreaterThan(0);
    expect(matchups[0].away).not.toBeNull();
  });
});

describe('mfl helpers', () => {
  it('treats a single object as a one-item list', () => {
    expect(list({ id: 1 })).toEqual([{ id: 1 }]);
    expect(list(undefined)).toEqual([]);
  });

  it('flips names and leaves team defenses alone', () => {
    expect(mflName('Prescott, Dak')).toBe('Dak Prescott');
    expect(mflName('Bills, Buffalo')).toBe('Buffalo Bills');
    expect(mflName('Kicker')).toBe('Kicker');
  });

  it('marks live starters, IR and taxi', () => {
    const r = toMflRosters(
      { rosters: { franchise: { id: '0001', player: [{ id: 'a', status: 'ROSTER' }, { id: 'b', status: 'ROSTER' }, { id: 'c', status: 'INJURED_RESERVE' }, { id: 'd', status: 'TAXI_SQUAD' }] } } },
      { liveScoring: { week: '4', matchup: { franchise: [{ id: '0001', players: { player: { id: 'a', status: 'starter' } } }] } } },
      { a: { name: 'Dak Prescott', position: 'QB', team: 'DAL' } },
      { a: 'Questionable' }
    );
    expect(r[0].players.map((p) => p.slot)).toEqual(['starter', 'bench', 'ir', 'taxi']);
    expect(r[0].players[0]).toMatchObject({ lineupSlot: 'QB', injury: 'Questionable', proTeam: 'DAL' });
  });

  it('skips retired players in the injury feed', () => {
    expect(toMflInjuries({ injuries: { injury: [{ id: '1', status: 'RETIRED' }, { id: '2', status: 'Out' }] } })).toEqual({ '2': 'Out' });
  });

  it('builds export urls and refuses error answers', () => {
    expect(exportUrl(2026, 'rosters', { L: '23456' })).toBe('https://api.myfantasyleague.com/2026/export?TYPE=rosters&L=23456&JSON=1');
    expect(() => assertMfl({ error: { $t: 'Invalid league ID 1' } })).toThrow(/Invalid league ID/);
    expect(mflSeason(new Date(2027, 0, 5))).toBe(2026);
  });
});
