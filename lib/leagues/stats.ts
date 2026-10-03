/**
 * The stat feeds behind 128BIT LEAGUES scoring, fetched and cached.
 *
 * Hockey: NHL web API (rosters, schedule, box scores) + NHL stats API.
 * Football: Sleeper weekly stats + the ESPN scoreboard for kickoff times.
 * A finished game's box score never changes, so it is kept for good; live
 * ones are re-read at most once a minute.
 */
import { getJsonItem, setJsonItem } from '@/lib/storage/kv';
import { cached, sleeperPlayers } from '@/lib/storage/player-cache';
import { parseScoreboard } from '@/src/betting/odds';
import { getJson } from '@/src/providers/http';
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
import { nflWeekOf, nflWeekStart, teamGames, weekOf, weekRange, type GameStat, type PlayerGame } from '@/src/leagues/season';
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

/** Stats for every rostered player in one league week. */
export async function weekStats(
  sport: HostedSport,
  season: string,
  seasonStart: string,
  week: number,
  pool: Map<string, PoolPlayer>,
  playerIds: Set<string>
): Promise<WeekStats> {
  return sport === 'nhl' ? nhlWeek(seasonStart, week, playerIds) : nflWeek(season, seasonStart, week, pool, playerIds);
}

/** The league week right now. */
export async function currentWeek(sport: HostedSport, seasonStart: string, now = new Date()): Promise<number> {
  if (sport === 'nhl') return weekOf(seasonStart, now);
  const start = await nflSeasonStart();
  return nflWeekOf(start, now) - nflWeekOf(start, new Date(seasonStart)) + 1;
}
