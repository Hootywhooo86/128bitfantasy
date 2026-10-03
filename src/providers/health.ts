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
import { YAHOO_AUTH_URL, YAHOO_TOKEN_URL } from './yahoo/oauth';

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
      // Fantasy data needs a login, so the probe checks the sign-in itself:
      // if Yahoo moves its OAuth endpoints, every connection breaks.
      url: 'https://api.login.yahoo.com/.well-known/openid-configuration',
      check: (data) => {
        if (!isObj(data)) return { status: 'changed', detail: 'Sign-in configuration is not JSON' };
        if (data.authorization_endpoint !== YAHOO_AUTH_URL || data.token_endpoint !== YAHOO_TOKEN_URL) {
          return { status: 'changed', detail: 'Yahoo moved its sign-in endpoints' };
        }
        return { status: 'ok', detail: 'Sign-in endpoints unchanged' };
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
    if (!res.ok && !(p.provider === 'fantrax' && isObj(data))) return { status: 'down', detail: `HTTP ${res.status}` };
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
