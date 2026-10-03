import { LOOKUP_TIMEOUT_MS, fetchWithTimeout } from '@/lib/net';
import type { ProviderId } from '@/src/sports/models';
import { ProviderError } from './types';

type GetOpts = { headers?: Record<string, string>; signal?: AbortSignal; label?: string; timeoutMs?: number };

/** Gateway hiccups worth one more try. A 4xx is an answer, not a hiccup. */
export const RETRY_STATUS = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 400;

/**
 * One fetch, retried once on a dropped connection or a gateway error.
 *
 * Sign-in reads a dozen URLs in parallel; without this a single dropped
 * packet on a stadium network failed the whole thing.
 */
async function fetchOnceMore(url: string, opts: GetOpts, provider: ProviderId): Promise<Response> {
  const go = () =>
    fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json', ...opts.headers }, signal: opts.signal },
      { timeoutMs: opts.timeoutMs ?? LOOKUP_TIMEOUT_MS * 2, label: opts.label ?? provider }
    );
  try {
    const res = await go();
    if (!RETRY_STATUS.has(res.status)) return res;
  } catch (e) {
    // A cancel is the user's decision; a timeout already waited long enough.
    if (opts.signal?.aborted || (e instanceof Error && e.name === 'NetworkTimeoutError')) throw e;
  }
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  return go();
}

/**
 * GET JSON with a deadline and an error the user can read.
 *
 * Every provider goes through this so a hung request always rejects and a
 * 401 always says "reconnect", whoever sent it.
 */
export async function getJson<T>(provider: ProviderId, url: string, opts: GetOpts = {}): Promise<T> {
  const res = await fetchOnceMore(url, opts, provider);
  if (!res.ok) {
    let message = statusMessage(provider, res.status);
    if (provider === 'yahoo' && res.status === 403) {
      const body = await res.text().catch(() => '');
      if (/not authorized/i.test(body)) {
        message =
          'Yahoo signed you in, but your Yahoo app is missing the Fantasy Sports permission. At developer.yahoo.com/apps → API Permissions → tick Fantasy Sports → Save, then sign in again.';
      }
    }
    throw new ProviderError(provider, message, res.status);
  }
  const text = await res.text();
  if (!text || text === 'null') {
    throw new ProviderError(provider, `${providerLabel(provider)} returned nothing for that request.`, 404);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, `${providerLabel(provider)} sent back something that is not data. It may be down.`);
  }
}

export function providerLabel(p: ProviderId): string {
  return { sleeper: 'Sleeper', yahoo: 'Yahoo', fantrax: 'Fantrax', espn: 'ESPN', fleaflicker: 'Fleaflicker', mfl: 'MyFantasyLeague' }[p];
}

export function statusMessage(p: ProviderId, status: number): string {
  const name = providerLabel(p);
  if (status === 401 || status === 403) {
    return `${name} refused access. Sign in again in Settings → ${name}${p === 'espn' ? ' (private leagues need espn_s2 and SWID)' : ''}.`;
  }
  if (status === 404) return `${name} could not find that league or user.`;
  if (status === 429) return `${name} is rate limiting. Try again in a minute.`;
  if (status >= 500) return `${name} is having problems right now (HTTP ${status}).`;
  return `${name} request failed (HTTP ${status}).`;
}
