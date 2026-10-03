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

describe('yahoo', () => {
  it('sign-in endpoints are where the app sends people', async () => {
    const { YAHOO_AUTH_URL, YAHOO_TOKEN_URL } = await import('@/src/providers/yahoo/oauth');
    const cfg = await getJson<{ authorization_endpoint: string; token_endpoint: string }>(
      'yahoo',
      'https://api.login.yahoo.com/.well-known/openid-configuration'
    );
    expect(cfg.authorization_endpoint).toBe(YAHOO_AUTH_URL);
    expect(cfg.token_endpoint).toBe(YAHOO_TOKEN_URL);
  }, 60_000);

  it('the data host is the one the adapter calls, and wants a login', async () => {
    const { YAHOO_API } = await import('@/src/providers/yahoo/adapter');
    const res = await fetch(`${YAHOO_API}/game/nfl?format=json`, { redirect: 'manual' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: unknown }).error).toBeTruthy();
  }, 60_000);
});

describe('player news, projections and lists', () => {
  it('ESPN player list has ids, names and news dates', async () => {
    const list = await getJson<{ id: number; fullName: string; lastNewsDate?: number }[]>(
      'espn',
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${new Date().getFullYear()}/players?view=players_wl`,
      { headers: { 'X-Fantasy-Filter': '{"filterActive":{"value":true}}' }, timeoutMs: 60_000 }
    );
    expect(list.length).toBeGreaterThan(1000);
    expect(list.some((p) => p.lastNewsDate)).toBe(true);
  }, 90_000);

  it('ESPN per-player news parses', async () => {
    const { parseEspnNews } = await import('@/src/sports/insights');
    // Justin Jefferson — a player who will have news for years.
    const raw = await getJson('espn', 'https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=3&playerId=4262921');
    const n = parseEspnNews(raw);
    expect(n.length).toBeGreaterThan(0);
    expect(n[0].headline.length).toBeGreaterThan(10);
  }, 60_000);

  it('Sleeper projections carry PPR / half / standard points', async () => {
    const state = await getJson<{ season: string; week: number }>('sleeper', 'https://api.sleeper.app/v1/state/nfl');
    const rows = await getJson<{ player_id: string; stats?: Record<string, number> }[]>(
      'sleeper',
      `https://api.sleeper.app/projections/nfl/${state.season}/${Math.max(1, state.week)}?season_type=regular`,
      { timeoutMs: 60_000 }
    );
    const r = rows.find((x) => x.stats?.pts_ppr != null);
    expect(r?.player_id).toBeTruthy();
    expect(typeof r?.stats?.pts_half_ppr).toBe('number');
  }, 90_000);
});

describe('betting odds (ESPN, free)', () => {
  it('scoreboard games carry DraftKings lines with direct bet links', async () => {
    const { parseScoreboard, hasOdds } = await import('@/src/betting/odds');
    const games = parseScoreboard(await getJson('espn', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'));
    expect(games.length).toBeGreaterThan(0);
    const priced = games.filter(hasOdds);
    // Off-season and the hours after the last game can have none; only check shape when present.
    for (const g of priced) {
      expect(g.home.teamId).toBeTruthy();
      const link = g.moneyline?.home.link ?? g.spread?.home.link;
      if (link) expect(link).toMatch(/^https:\/\/sportsbook\.draftkings\.com\//);
    }
  }, 60_000);

  it('player lines load for a game with odds', async () => {
    const { corePath, parseProps, parseScoreboard, hasOdds } = await import('@/src/betting/odds');
    const games = parseScoreboard(await getJson('espn', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'));
    const g = games.find((x) => hasOdds(x) && x.status === 'STATUS_SCHEDULED');
    if (!g) return; // nothing upcoming right now
    const base = `https://sports.core.api.espn.com/v2/sports/${corePath('nfl')}/events/${g.eventId}/competitions/${g.eventId}/odds`;
    const list = await getJson<{ items: { provider: { id: string } }[] }>('espn', `${base}?lang=en&region=us`);
    const props = parseProps(await getJson('espn', `${base}/${list.items[0].provider.id}/propBets?lang=en&region=us&limit=1000`, { timeoutMs: 60_000 }));
    expect(props.size).toBeGreaterThan(0);
  }, 120_000);
});

describe('128BIT LEAGUES stat feeds', () => {
  it('NHL rosters, season totals and a finished box score parse', async () => {
    const { buildNhlPool, NHL_STATS, NHL_WEB, parseNhlBoxscore, parseNhlGames } = await import('@/src/leagues/nhl');
    const q = (k: string) => `${NHL_STATS}/${k}?limit=-1&cayenneExp=${encodeURIComponent('seasonId=20252026 and gameTypeId=2')}`;
    const [roster, summary, realtime, goalies] = await Promise.all([
      getJson('bit128', `${NHL_WEB}/roster/EDM/current`),
      getJson('bit128', q('skater/summary'), { timeoutMs: 60_000 }),
      getJson('bit128', q('skater/realtime'), { timeoutMs: 60_000 }),
      getJson('bit128', q('goalie/summary'), { timeoutMs: 60_000 }),
    ]);
    const pool = buildNhlPool([{ team: 'EDM', json: roster }], summary, realtime, goalies);
    expect(pool.length).toBeGreaterThan(15);
    expect(pool.some((p) => p.position === 'G')).toBe(true);
    expect(pool.some((p) => (p.seasonLine.goals ?? 0) > 0 && typeof p.seasonLine.hits === 'number')).toBe(true);

    const week = parseNhlGames(await getJson('bit128', `${NHL_WEB}/schedule/2026-04-13`));
    expect(week.length).toBeGreaterThan(0);
    const box = parseNhlBoxscore(await getJson('bit128', `${NHL_WEB}/gamecenter/${week[0].id}/boxscore`));
    expect(box.state).toBe('final');
    expect(box.lines.size).toBeGreaterThan(30);
  }, 120_000);

  it("Sleeper weekly stats still score the same as Sleeper's PPR", async () => {
    const { parseSleeperWeek, SLEEPER_STATS } = await import('@/src/leagues/nfl');
    const { fantasyPoints, NFL_SCORING } = await import('@/src/leagues/scoring');
    const week = parseSleeperWeek(await getJson('bit128', `${SLEEPER_STATS}/2025/5`, { timeoutMs: 60_000 }));
    const scored = [...week.values()].filter((l) => (l.pts_ppr ?? 0) > 5);
    expect(scored.length).toBeGreaterThan(100);
    // Nearly every player should match to the hundredth; a few odd stats (return TDs, 2-pt plays) may differ.
    const off = scored.filter((l) => Math.abs(fantasyPoints(l, NFL_SCORING) - l.pts_ppr) > 0.05);
    expect(off.length / scored.length).toBeLessThan(0.03);
  }, 120_000);
});
