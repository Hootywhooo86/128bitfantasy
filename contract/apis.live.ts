/**
 * Live contract tests: hit the real fantasy APIs and fail when what they send
 * stops matching what our parsers read.
 *
 *   npm run test:live
 *
 * Run daily by .github/workflows/api-watch.yml, so a provider changing its API
 * turns CI red (and emails the repo owner) before users see blank screens.
 */
import { describe, expect, it } from 'vitest';
import { getJson } from '@/src/providers/http';
import { checkApis, SLEEPER_PROBE_LEAGUE } from '@/src/providers/health';
import { toLeague, toMatchups, toRoster, toTeams } from '@/src/providers/sleeper/adapter';
import { sleeper } from '@/src/providers/sleeper/client';

describe('provider health probes', () => {
  it('every provider answers in the expected shape', async () => {
    const r = await checkApis();
    const report = Object.entries(r.results).map(([p, h]) => `${p}: ${h.status} — ${h.detail}`).join('\n');
    console.log(report);
    // A changed shape is a failure. An outage on one day is not ours to fix,
    // so only "changed" fails the run.
    expect(Object.values(r.results).filter((h) => h.status === 'changed'), report).toEqual([]);
  }, 60_000);
});

describe('sleeper end to end', () => {
  it('parses a real league into teams, rosters and matchups', async () => {
    const raw = await sleeper.league(SLEEPER_PROBE_LEAGUE);
    const [users, rosters, week] = await Promise.all([
      sleeper.users(raw.league_id),
      sleeper.rosters(raw.league_id),
      sleeper.matchups(raw.league_id, 1),
    ]);
    const league = toLeague(raw, users[0].user_id, rosters);
    expect(league.myTeamId).not.toBeNull();
    const teams = toTeams(rosters, users);
    expect(teams.length).toBe(raw.total_rosters);
    expect(teams.every((t) => t.name && t.record)).toBe(true);
    const roster = toRoster(rosters[0], raw.roster_positions ?? [], {});
    expect(roster.players.some((p) => p.slot === 'starter')).toBe(true);
    expect(toMatchups(week, 1).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('fantrax player feed', () => {
  it('still maps fantraxId to name, team and position', async () => {
    const raw = await getJson<Record<string, { name?: string; team?: string; position?: string; fantraxId?: string }>>(
      'fantrax',
      'https://www.fantrax.com/fxea/general/getPlayerIds?sport=NHL',
      { timeoutMs: 60_000 }
    );
    const sample = Object.values(raw).slice(0, 50);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.every((p) => typeof p.name === 'string' && typeof p.fantraxId === 'string')).toBe(true);
  }, 90_000);
});

describe('mfl end to end', () => {
  it('parses a real public league', async () => {
    const { exportUrl, toMflLeague, toMflTeams, toMflRosters, toMflPlayers, toMflMatchups, mflSeason } = await import('@/src/providers/mfl/adapter');
    const season = mflSeason();
    const L = { L: '23456' };
    const [lg, rosters, standings, live, players] = await Promise.all(
      ['league', 'rosters', 'leagueStandings', 'liveScoring', 'players'].map((t) =>
        getJson('mfl', exportUrl(season, t, t === 'players' ? {} : L), { timeoutMs: 60_000 })
      )
    );
    expect(toMflLeague(lg, String(season), null).name.length).toBeGreaterThan(0);
    const teams = toMflTeams(lg, standings);
    expect(teams.length).toBeGreaterThan(1);
    const r = toMflRosters(rosters, live, toMflPlayers(players), {});
    expect(r.some((x) => x.players.some((p) => p.name !== p.id))).toBe(true);
    expect(toMflMatchups(live).period).not.toBeNull();
  }, 120_000);
});
