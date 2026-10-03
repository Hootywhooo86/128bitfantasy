/**
 * The API watch: is each provider still answering the way our parsers expect?
 *
 * Fantasy APIs change without notice — ESPN moved hosts, Yahoo moved to
 * OAuth 2.0, Fantrax rotates its internals. Each probe is one cheap public
 * request plus a check of the fields we depend on, so a change shows up as
 * "CHANGED: missing currentScoringPeriod" rather than as blank screens.
 *
 * Runs from Settings → CHECK FANTASY APIS, on launch at most once a day, and
 * daily in CI (contract/apis.live.ts) so a change is caught before users hit it.
 */
import { fetchWithTimeout } from '@/lib/net';
import type { ProviderId } from '@/src/sports/models';

export type Health =
  | { status: 'ok'; detail: string }
  /** Answered, but not in the shape we read. Data may be missing. */
  | { status: 'changed'; detail: string }
  /** Did not answer, or answered with an error. */
  | { status: 'down'; detail: string };

export type HealthReport = { checkedAt: number; results: Record<ProviderId, Health> };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Dotted paths that must exist, e.g. "currentScoringPeriod.id". Returns the missing ones. */
export function missingPaths(data: unknown, paths: string[]): string[] {
  return paths.filter((p) => {
    let cur: unknown = data;
    for (const k of p.split('.')) {
      if (!isObj(cur) || !(k in cur)) return true;
      cur = cur[k];
    }
    return false;
  });
}

export type Probe = {
  provider: ProviderId;
  url: string;
  /** Error statuses that still count as the API answering (e.g. 401 without a login). */
  answers?: number[];
  /** Turns the parsed body into a verdict. */
  check: (data: unknown, status: number) => Health;
};

const shape = (paths: string[], ok: string) => (data: unknown): Health => {
  const missing = missingPaths(data, paths);
  return missing.length ? { status: 'changed', detail: `Missing ${missing.join(', ')}` } : { status: 'ok', detail: ok };
};

/** A Sleeper league that has existed since 2018 — Sleeper's own docs use it. */
export const SLEEPER_PROBE_LEAGUE = '289646328504385536';

export function probes(season = new Date().getFullYear()): Probe[] {
  return [
    {
      provider: 'sleeper',
      url: `https://api.sleeper.app/v1/league/${SLEEPER_PROBE_LEAGUE}`,
      check: shape(['league_id', 'roster_positions', 'scoring_settings', 'total_rosters'], 'League, roster and scoring fields present'),
    },
    {
      provider: 'yahoo',
      // The data host itself. Without a login it must answer 401 with a JSON
      // error — anything else (a redirect, an HTML page) means the API moved,
      // which is exactly the bug that broke Yahoo in the first build.
      url: 'https://fantasysports.yahooapis.com/fantasy/v2/game/nfl?format=json',
      answers: [401],
      check: (data, status) => {
        if (status === 401 && isObj(data) && isObj(data.error)) return { status: 'ok', detail: 'API host answering (sign-in required)' };
        if (status === 200 && isObj(data) && 'fantasy_content' in data) return { status: 'ok', detail: 'API host answering' };
        return { status: 'changed', detail: 'API host answered in an unexpected way' };
      },
    },
    {
      provider: 'espn',
      url: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}`,
      check: shape(['id', 'currentScoringPeriod.id'], 'Read host up, season data present'),
    },
    {
      provider: 'fantrax',
      // An id that cannot exist: Fantrax answers with its error object, which
      // proves the feed is up and still speaking JSON without pulling a league.
      url: 'https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=128bit-probe',
      check: (data) =>
        isObj(data) && (isObj(data.error) || 'leagueName' in data)
          ? { status: 'ok', detail: 'Public feed answering' }
          : { status: 'changed', detail: 'Feed answered in an unknown shape' },
    },
    {
      provider: 'mfl',
      // MFL's own schedule export: public, small, and the shape our live scoring parse shares.
      url: `https://api.myfantasyleague.com/${season}/export?TYPE=nflSchedule&JSON=1`,
      check: shape(['nflSchedule.matchup'], 'Export API answering'),
    },
    {
      // 128BIT LEAGUES scoring rides on the NHL's own feed: today's scores
      // (box scores share its game ids) must still list games with states.
      provider: 'bit128',
      url: 'https://api-web.nhle.com/v1/score/now',
      check: shape(['games'], 'NHL scores feed answering'),
    },
    {
      provider: 'fleaflicker',
      url: 'https://www.fleaflicker.com/api/FetchUserLeagues?sport=NFL&email=probe%40example.com',
      check: (data) =>
        isObj(data) ? { status: 'ok', detail: 'API answering' } : { status: 'changed', detail: 'Answered in an unknown shape' },
    },
  ];
}

export async function runProbe(p: Probe, signal?: AbortSignal): Promise<Health> {
  try {
    const res = await fetchWithTimeout(p.url, { headers: { Accept: 'application/json' }, signal }, { timeoutMs: 15_000, label: p.provider });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return res.ok
        ? { status: 'changed', detail: 'Answered with something that is not JSON' }
        : { status: 'down', detail: `HTTP ${res.status}` };
    }
    if (!res.ok && !(p.answers ?? []).includes(res.status) && !(p.provider === 'fantrax' && isObj(data))) {
      return { status: 'down', detail: `HTTP ${res.status}` };
    }
    return p.check(data, res.status);
  } catch (e) {
    return { status: 'down', detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function checkApis(signal?: AbortSignal): Promise<HealthReport> {
  const list = probes();
  const results = await Promise.all(list.map((p) => runProbe(p, signal)));
  return {
    checkedAt: Date.now(),
    results: Object.fromEntries(list.map((p, i) => [p.provider, results[i]])) as Record<ProviderId, Health>,
  };
}
