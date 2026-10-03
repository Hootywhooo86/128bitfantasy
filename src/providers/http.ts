import { LOOKUP_TIMEOUT_MS, fetchWithTimeout } from '@/lib/net';
import type { ProviderId } from '@/src/sports/models';
import { ProviderError } from './types';

/**
 * GET JSON with a deadline and an error the user can read.
 *
 * Every provider goes through this so a hung request always rejects and a
 * 401 always says "reconnect", whoever sent it.
 */
export async function getJson<T>(
  provider: ProviderId,
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; label?: string; timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: 'application/json', ...opts.headers }, signal: opts.signal },
    { timeoutMs: opts.timeoutMs ?? LOOKUP_TIMEOUT_MS * 2, label: opts.label ?? provider }
  );
  if (!res.ok) {
    throw new ProviderError(provider, statusMessage(provider, res.status), res.status);
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
  return { sleeper: 'Sleeper', yahoo: 'Yahoo', fantrax: 'Fantrax', espn: 'ESPN', fleaflicker: 'Fleaflicker' }[p];
}

export function statusMessage(p: ProviderId, status: number): string {
  const name = providerLabel(p);
  if (status === 401 || status === 403) {
    return `${name} refused access. Reconnect it in Leagues → ${name}${p === 'espn' ? ' (private leagues need espn_s2 and SWID)' : ''}.`;
  }
  if (status === 404) return `${name} could not find that league or user.`;
  if (status === 429) return `${name} is rate limiting. Try again in a minute.`;
  if (status >= 500) return `${name} is having problems right now (HTTP ${status}).`;
  return `${name} request failed (HTTP ${status}).`;
}
