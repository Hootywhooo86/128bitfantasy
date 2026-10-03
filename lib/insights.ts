/**
 * Loads the extra player data and hands back insights per player.
 *
 * Every source is cached, and every source is optional: if one fails the rest
 * still show, and nothing is invented to fill the gap.
 */
import { useEffect, useRef, useState } from 'react';
import { getJson } from '@/src/providers/http';
import { espnSeason } from '@/src/providers/espn/client';
import {
  buildEspnIndex,
  buildSleeperIndex,
  ESPN_NEWS_GAME,
  insightFor,
  parseEspnNews,
  type EspnIndex,
  type EspnPlayer,
  type NewsItem,
  type PlayerInsight,
  type Projections,
  type SleeperIndex,
} from '@/src/sports/insights';
import type { LeagueSnapshot, Roster, Sport } from '@/src/sports/models';
import { cached, sleeperPlayers } from './storage/player-cache';

const HOUR = 60 * 60 * 1000;

/** Built indexes, kept for the session — building them is the slow part. */
const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make().catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, p);
  }
  return p;
}

export function sleeperIndex(): Promise<SleeperIndex> {
  return once('sleeper-index', async () => buildSleeperIndex(await sleeperPlayers('nfl')));
}

export function espnIndex(sport: Sport): Promise<EspnIndex> {
  const season = espnSeason(sport);
  const game = ESPN_NEWS_GAME[sport];
  return once(`espn-index-${sport}-${season}`, async () =>
    buildEspnIndex(
      await cached(
        `espn_players_${game}_${season}`,
        async () => {
          const list = await getJson<EspnPlayer[]>(
            'espn',
            `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${game}/seasons/${season}/players?view=players_wl`,
            { headers: { 'X-Fantasy-Filter': '{"filterActive":{"value":true}}' }, timeoutMs: 30_000, label: 'ESPN player list' }
          );
          // Only what the insights read.
          return list.map((p) => ({ id: p.id, fullName: p.fullName, proTeamId: p.proTeamId, lastNewsDate: p.lastNewsDate }));
        },
        6 * HOUR
      )
    )
  );
}

export function nflProjections(season: string, week: number): Promise<Projections> {
  return once(`proj-${season}-${week}`, () =>
    cached(
      `sleeper_proj_${season}_${week}`,
      async () => {
        const rows = await getJson<{ player_id: string; stats?: { pts_ppr?: number; pts_half_ppr?: number; pts_std?: number } }[]>(
          'sleeper',
          `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular`,
          { timeoutMs: 30_000, label: 'Sleeper projections' }
        );
        const out: Projections = {};
        for (const r of rows ?? []) {
          const st = r.stats;
          if (!st || st.pts_ppr == null) continue;
          out[r.player_id] = { ppr: st.pts_ppr, half: st.pts_half_ppr, std: st.pts_std };
        }
        return out;
      },
      HOUR
    )
  );
}

export async function playerNews(sport: Sport, espnId: string): Promise<NewsItem[]> {
  const raw = await cached(
    `espn_news_${sport}_${espnId}`,
    () =>
      getJson<unknown>(
        'espn',
        `https://site.api.espn.com/apis/fantasy/v2/games/${ESPN_NEWS_GAME[sport]}/news/players?limit=10&playerId=${encodeURIComponent(espnId)}`,
        { label: 'Player news' }
      ),
    30 * 60 * 1000
  );
  return parseEspnNews(raw);
}

/**
 * Insights for one roster, by player id. Starts empty and fills in as each
 * source arrives, so the roster never waits on the extras.
 *
 * Keyed on plain values, not the snapshot object: a snapshot with the user's
 * team pick applied is a new object every render, and depending on it would
 * re-run this forever.
 */
export function useInsights(snap: LeagueSnapshot | null, roster: Roster | undefined): Record<string, PlayerInsight> {
  return useInsightsFor(snap, roster ? [roster] : null);
}

/** The same, for several rosters at once (both sides of a matchup, a whole league). */
export function useInsightsFor(snap: LeagueSnapshot | null, rosters: Roster[] | null): Record<string, PlayerInsight> {
  const [out, setOut] = useState<Record<string, PlayerInsight>>({});
  // Callers may pass a freshly filtered array each render; the work re-runs
  // only when what it describes changes (which teams, which refresh).
  const rostersRef = useRef(rosters);
  useEffect(() => {
    rostersRef.current = rosters;
  });
  const rosterKey = rosters?.length ? `${snap?.fetchedAt ?? 0}:${rosters.map((r) => `${r.teamId}/${r.players.length}`).join(',')}` : '';
  const league = snap?.league;
  const provider = league?.provider;
  const leagueId = league?.id;
  const sport = league?.sport;
  const season = league?.season;
  const scoring = league?.scoring ?? null;
  const period = snap?.period;
  useEffect(() => {
    const rosters = rostersRef.current;
    if (!provider || !leagueId || !sport || !season || !rosters?.length || !rosterKey) return;
    let live = true;
    const lg = { provider, id: leagueId, sport, season, scoring, name: '', teamCount: null, myTeamId: null };
    const nfl = sport === 'nfl';
    const src = {
      sleeper: null as SleeperIndex | null,
      projections: null as Projections | null,
      espn: null as EspnIndex | null,
    };
    const publish = () => {
      if (live) setOut(Object.fromEntries(rosters.flatMap((r) => r.players).map((p) => [p.id, insightFor(p, lg, src)])));
    };
    publish();
    const loads: Promise<unknown>[] = [espnIndex(sport).then((x) => (src.espn = x))];
    if (nfl) {
      loads.push(sleeperIndex().then((x) => (src.sleeper = x)));
      if (period) loads.push(nflProjections(season, period).then((x) => (src.projections = x)));
    }
    for (const l of loads) l.then(publish, () => undefined);
    return () => {
      live = false;
    };
  }, [provider, leagueId, sport, season, scoring, period, rosterKey]);
  return out;
}
