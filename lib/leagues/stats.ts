/**
 * The stat feeds behind 128BIT LEAGUES scoring, fetched and cached.
 *
 * Hockey: NHL web API (rosters, schedule, box scores) + NHL stats API.
 * Baseball: MLB Stats API (rosters, schedule, box scores, season totals).
 * Football: Sleeper weekly stats + the ESPN scoreboard for kickoff times.
 * Basketball: Sleeper per-game stats + the ESPN scoreboard for tip-off times.
 * A finished game's box score never changes, so it is kept for good; live
 * ones are re-read at most once a minute.
 */
import { getJsonItem, setJsonItem } from '@/lib/storage/kv';
import { cached, sleeperPlayers } from '@/lib/storage/player-cache';
import { parseScoreboard } from '@/src/betting/odds';
import { getJson } from '@/src/providers/http';
import { sleeper } from '@/src/providers/sleeper/client';
import { abbrMap, buildMlbPool, MLB_API, parseMlbBoxscore, parseMlbSchedule } from '@/src/leagues/mlb';
import { buildNbaPool, ESPN_TO_SLEEPER_NBA, parseNbaWeek, SLEEPER_NBA, SLEEPER_NBA_SEASON, sleeperNbaWeek } from '@/src/leagues/nba';
import { buildNflPool, parseSleeperWeek, SLEEPER_STATS } from '@/src/leagues/nfl';
import {
  buildNhlPool,
  NHL_STATS,
  NHL_TEAMS,
  NHL_WEB,
  nhlPoolFromStats,
  parseNhlBoxscore,
  parseNhlGames,
  previousNhlSeason,
  type GameLines,
  type NhlGameState,
} from '@/src/leagues/nhl';
import type { HostedSport, StatLine } from '@/src/leagues/scoring';
import { nflWeekOf, nflWeekStart, teamGames, weekOf, weekRange, type GameState, type GameStat, type PlayerGame } from '@/src/leagues/season';
import type { PoolPlayer } from '@/src/leagues/types';

const DAY = 86_400_000;
const MINUTE = 60_000;

const get = <T,>(url: string, label: string) => getJson<T>('bit128', url, { label, timeoutMs: 30_000 });

function statsUrl(kind: 'skater/summary' | 'skater/realtime' | 'goalie/summary', season: string): string {
  return `${NHL_STATS}/${kind}?limit=-1&cayenneExp=${encodeURIComponent(`seasonId=${season} and gameTypeId=2`)}`;
}

/** Everyone who can be drafted, with last season's totals. Cached a day. */
export function playerPool(sport: HostedSport, season: string): Promise<PoolPlayer[]> {
  return cached(`hosted_pool_v1_${sport}_${season}`, async () => {
    if (sport === 'mlb') return mlbPool(season);
    if (sport === 'nba') {
      const [catalog, last] = await Promise.all([
        sleeper.players('nba'),
        get(`${SLEEPER_NBA_SEASON}/${Number(season) - 1}`, 'Last season stats').catch(() => ({})),
      ]);
      return buildNbaPool(catalog as Parameters<typeof buildNbaPool>[0], last);
    }
    if (sport === 'nfl') {
      const [catalog, last] = await Promise.all([
        sleeperPlayers('nfl'),
        get(`${SLEEPER_STATS}/${Number(season) - 1}`, 'Last season stats').catch(() => ({})),
      ]);
      return buildNflPool(catalog as Record<string, { full_name?: string | null; position?: string | null; team?: string | null }>, last);
    }
    const prev = previousNhlSeason(season);
    const [summary, realtime, goalies] = await Promise.all([
      get(statsUrl('skater/summary', prev), 'NHL skater stats'),
      get(statsUrl('skater/realtime', prev), 'NHL hits and blocks').catch(() => ({ data: [] })),
      get(statsUrl('goalie/summary', prev), 'NHL goalie stats'),
    ]);
    // Current rosters say who's where today; any team that fails falls back to last season's stats.
    const rosters = await Promise.all(
      NHL_TEAMS.map((team) =>
        get(`${NHL_WEB}/roster/${team}/current`, `${team} roster`).then(
          (json) => ({ team, json }),
          () => null
        )
      )
    );
    const ok = rosters.filter((r): r is { team: (typeof NHL_TEAMS)[number]; json: unknown } => !!r);
    return ok.length >= 28 ? buildNhlPool(ok, summary, realtime, goalies) : nhlPoolFromStats(summary, realtime, goalies);
  });
}

/** A game's lines; finished games come from the phone after the first read. */
async function nhlBox(gameId: string, state: NhlGameState): Promise<GameLines> {
  const key = `nhl_box_v1_${gameId}`;
  const kept = await getJsonItem<{ state: NhlGameState; start: string; lines: [string, StatLine][] }>(key);
  if (kept?.state === 'final') return { gameId, state: 'final', start: kept.start, lines: new Map(kept.lines) };
  const box = await cached(
    `nhl_box_live_${gameId}`,
    async () => {
      const g = parseNhlBoxscore(await get(`${NHL_WEB}/gamecenter/${gameId}/boxscore`, 'NHL box score'));
      return { state: g.state, start: g.start, lines: [...g.lines] as [string, StatLine][] };
    },
    state === 'final' ? 0 : MINUTE
  );
  if (box.state === 'final') await setJsonItem(key, box);
  return { gameId, state: box.state, start: box.start, lines: new Map(box.lines) };
}


export type WeekStats = {
  stats: GameStat[];
  /** Each pro team's next or current game this week, for LIVE / FINAL tags. */
  games: Map<string, PlayerGame>;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);


async function nhlWeek(seasonStart: string, week: number, playerIds: Set<string>): Promise<WeekStats> {
  const { from, to } = weekRange(seasonStart, week);
  const sched = await cached(`nhl_sched_v1_${ymd(from)}`, async () => parseNhlGames(await get(`${NHL_WEB}/schedule/${ymd(from)}`, 'NHL schedule')), 10 * MINUTE);
  const inWeek = sched.filter((g) => {
    const t = Date.parse(g.start);
    return t >= from.getTime() && t < to.getTime();
  });
  const now = Date.now();
  const started = inWeek.filter((g) => g.state !== 'pre' || Date.parse(g.start) <= now);
  const boxes = await Promise.all(started.map((g) => nhlBox(g.id, g.state).catch(() => null)));
  const stats: GameStat[] = [];
  // The schedule is cached for minutes; a box score knows the state right now.
  const fresh = new Map(inWeek.map((g) => [g.id, g]));
  for (const b of boxes) {
    if (!b) continue;
    const g = fresh.get(b.gameId);
    if (g) fresh.set(g.id, { ...g, state: b.state });
    for (const [pid, line] of b.lines) if (playerIds.has(pid)) stats.push({ playerId: pid, start: g?.start ?? b.start, line });
  }
  return { stats, games: teamGames([...fresh.values()], now) };
}

/** The NFL's own week for a date, from Sleeper's season start (a Wednesday-ish). */
async function nflSeasonStart(): Promise<string> {
  const st = await cached('sleeper_state_nfl', () => get<{ season_start_date?: string }>('https://api.sleeper.app/v1/state/nfl', 'NFL week'), DAY / 4);
  return st.season_start_date ?? `${new Date().getUTCFullYear()}-09-09`;
}


/** League week N → NFL week, counting from the NFL week the league started in. */
export async function nflWeekFor(leagueStart: string, leagueWeek: number): Promise<number> {
  const start = await nflSeasonStart();
  return nflWeekOf(start, new Date(leagueStart)) + leagueWeek - 1;
}

async function nflWeek(season: string, leagueStart: string, week: number, pool: Map<string, PoolPlayer>, playerIds: Set<string>): Promise<WeekStats> {
  const nflWk = await nflWeekFor(leagueStart, week);
  const weekStart = nflWeekStart(await nflSeasonStart(), nflWk).toISOString();
  const [raw, board] = await Promise.all([
    cached(`sleeper_week_${season}_${nflWk}`, () => get(`${SLEEPER_STATS}/${season}/${nflWk}`, 'NFL week stats'), MINUTE),
    cached(
      `espn_nfl_week_${season}_${nflWk}`,
      async () => parseScoreboard(await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${nflWk}`, 'NFL scoreboard')),
      2 * MINUTE
    ).catch(() => []),
  ]);
  const games = new Map<string, PlayerGame>();
  for (const g of board) {
    const s = g.status.toUpperCase();
    const state: NhlGameState = /FINAL/.test(s) ? 'final' : /PROGRESS|HALFTIME|END_PERIOD/.test(s) ? 'live' : 'pre';
    games.set(g.home.abbr.toUpperCase(), { state, start: g.startsAt, opponent: g.away.abbr });
    games.set(g.away.abbr.toUpperCase(), { state, start: g.startsAt, opponent: g.home.abbr });
  }
  // ESPN and Sleeper spell two teams differently.
  const alias: Record<string, string> = { WAS: 'WSH', JAC: 'JAX' };
  const stats: GameStat[] = [];
  for (const [pid, line] of parseSleeperWeek(raw)) {
    if (!playerIds.has(pid)) continue;
    const team = pool.get(pid)?.team?.toUpperCase() ?? '';
    const g = games.get(alias[team] ?? team);
    // No kickoff known: judge the lineup at the start of the NFL week.
    stats.push({ playerId: pid, start: g?.start ?? weekStart, line });
  }
  return { stats, games };
}

// ── Baseball ──

const mlbTeams = () => cached('mlb_teams_v1', async () => [...abbrMap(await get(`${MLB_API}/teams?sportId=1`, 'MLB teams'))], DAY * 7);

async function mlbPool(season: string): Promise<PoolPlayer[]> {
  const abbr = new Map(await mlbTeams());
  const prev = Number(season) - 1;
  const statsUrl = (group: 'hitting' | 'pitching') =>
    `${MLB_API}/stats?stats=season&group=${group}&season=${prev}&sportId=1&limit=3000&playerPool=ALL`;
  const [hitting, pitching] = await Promise.all([get(statsUrl('hitting'), 'MLB hitting stats'), get(statsUrl('pitching'), 'MLB pitching stats')]);
  const rosters = await Promise.all(
    [...abbr].map(([id, team]) =>
      get(`${MLB_API}/teams/${id}/roster?rosterType=40Man`, `${team} roster`).then(
        (json) => ({ team, json }),
        () => null
      )
    )
  );
  const ok = rosters.filter((r): r is { team: string; json: unknown } => !!r);
  return buildMlbPool(ok.length >= 26 ? ok : [], hitting, pitching, abbr);
}

/** A finished box score is kept for good; a live one is re-read at most once a minute. */
async function keptBox(key: string, final: boolean, load: () => Promise<Map<string, StatLine>>): Promise<Map<string, StatLine>> {
  const kept = await getJsonItem<[string, StatLine][]>(`${key}_final`);
  if (kept) return new Map(kept);
  const lines = await cached(`${key}_live`, async () => [...(await load())] as [string, StatLine][], final ? 0 : MINUTE);
  if (final) await setJsonItem(`${key}_final`, lines);
  return new Map(lines);
}

async function mlbWeek(seasonStart: string, week: number, playerIds: Set<string>): Promise<WeekStats> {
  const { from, to } = weekRange(seasonStart, week);
  const abbr = new Map(await mlbTeams());
  const last = new Date(to.getTime() - DAY);
  const sched = await cached(
    `mlb_sched_v1_${ymd(from)}`,
    async () => parseMlbSchedule(await get(`${MLB_API}/schedule?sportId=1&startDate=${ymd(from)}&endDate=${ymd(last)}`, 'MLB schedule'), abbr),
    MINUTE
  );
  const inWeek = sched.filter((g) => {
    const t = Date.parse(g.start);
    return t >= from.getTime() && t < to.getTime();
  });
  const now = Date.now();
  const started = inWeek.filter((g) => g.state !== 'pre' || Date.parse(g.start) <= now);
  const stats: GameStat[] = [];
  await Promise.all(
    started.map(async (g) => {
      const lines = await keptBox(`mlb_box_v1_${g.id}`, g.state === 'final', async () =>
        parseMlbBoxscore(await get(`${MLB_API}/game/${g.id}/boxscore`, 'MLB box score'), g.state === 'final')
      ).catch(() => null);
      if (!lines) return;
      for (const [pid, line] of lines) if (playerIds.has(pid)) stats.push({ playerId: pid, start: g.start, line });
    })
  );
  return { stats, games: teamGames(inWeek, now) };
}

// ── Basketball ──

async function nbaSeasonStart(): Promise<string> {
  const st = await cached('sleeper_state_nba', () => get<{ season_start_date?: string }>('https://api.sleeper.app/v1/state/nba', 'NBA week'), DAY / 4);
  return st.season_start_date ?? `${new Date().getUTCFullYear()}-10-20`;
}

/** Tip-off times and game states for one date, keyed by Sleeper's team abbreviation. */
async function nbaTips(date: string): Promise<Map<string, PlayerGame>> {
  const games = await cached(
    `espn_nba_${date}`,
    async () =>
      parseScoreboard(await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`, 'NBA scoreboard')),
    2 * MINUTE
  ).catch(() => []);
  const out = new Map<string, PlayerGame>();
  for (const g of games) {
    const s = g.status.toUpperCase();
    const state: GameState = /FINAL/.test(s) ? 'final' : /PROGRESS|HALFTIME|END_PERIOD/.test(s) ? 'live' : 'pre';
    const h = ESPN_TO_SLEEPER_NBA[g.home.abbr] ?? g.home.abbr;
    const a = ESPN_TO_SLEEPER_NBA[g.away.abbr] ?? g.away.abbr;
    out.set(h, { state, start: g.startsAt, opponent: a });
    out.set(a, { state, start: g.startsAt, opponent: h });
  }
  return out;
}

async function nbaWeek(season: string, seasonStart: string, week: number, playerIds: Set<string>): Promise<WeekStats> {
  const { from, to } = weekRange(seasonStart, week);
  const start = await nbaSeasonStart();
  const days: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY) days.push(ymd(new Date(t)));
  // Our weeks and Sleeper's both start on Mondays, but a week can still touch two of Sleeper's.
  const sleeperWeeks = [...new Set([sleeperNbaWeek(start, from), sleeperNbaWeek(start, new Date(to.getTime() - DAY))])];
  const rows = (
    await Promise.all(
      sleeperWeeks.map((w) =>
        cached(`sleeper_nba_${season}_${w}`, async () => parseNbaWeek(await get(`${SLEEPER_NBA}/${season}/${w}?season_type=regular`, 'NBA stats')), MINUTE)
      )
    )
  ).flat();
  const tips = new Map(await Promise.all(days.map(async (d) => [d, await nbaTips(d)] as const)));
  const stats: GameStat[] = [];
  for (const r of rows) {
    if (!playerIds.has(r.playerId) || !days.includes(r.date)) continue;
    // Locks at tip-off; with no tip time, 7pm Eastern on the game date.
    const tip = tips.get(r.date)?.get(r.team)?.start ?? `${r.date}T23:00:00Z`;
    stats.push({ playerId: r.playerId, start: tip, line: r.line });
  }
  // Each game once (the map has it under both teams), then the usual pick per team.
  const list = [...tips.values()].flatMap((m) =>
    [...m].filter(([team, g]) => team < (g.opponent ?? '')).map(([team, g]) => ({ start: g.start, state: g.state, home: team, away: g.opponent ?? '' }))
  );
  const games = teamGames(list, Date.now());
  return { stats, games };
}

/** Stats for every rostered player in one league week. */
export async function weekStats(
  sport: HostedSport,
  season: string,
  seasonStart: string,
  week: number,
  pool: Map<string, PoolPlayer>,
  playerIds: Set<string>
): Promise<WeekStats> {
  switch (sport) {
    case 'nhl':
      return nhlWeek(seasonStart, week, playerIds);
    case 'mlb':
      return mlbWeek(seasonStart, week, playerIds);
    case 'nba':
      return nbaWeek(season, seasonStart, week, playerIds);
    default:
      return nflWeek(season, seasonStart, week, pool, playerIds);
  }
}

/** The league week right now. */
export async function currentWeek(sport: HostedSport, seasonStart: string, now = new Date()): Promise<number> {
  // Hockey, baseball and basketball play Monday-to-Sunday weeks; football uses NFL weeks.
  if (sport !== 'nfl') return weekOf(seasonStart, now);
  const start = await nflSeasonStart();
  return nflWeekOf(start, now) - nflWeekOf(start, new Date(seasonStart)) + 1;
}
