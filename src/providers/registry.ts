/**
 * Every provider, wired to its storage-backed helpers.
 *
 * The adapters themselves are pure (fetch in, normalized models out); this is
 * the one place that hands them the player caches and the token saver.
 */
import { saveConnection } from '@/lib/storage/connections';
import { fantraxPlayers, sleeperPlayers } from '@/lib/storage/player-cache';
import type { ProviderId } from '@/src/sports/models';
import { espnAdapter } from './espn/adapter';
import { createFantraxAdapter } from './fantrax/adapter';
import { fleaflickerAdapter } from './fleaflicker/adapter';
import { createSleeperAdapter } from './sleeper/adapter';
import type { Connection, ProviderAdapter } from './types';
import { createYahooAdapter } from './yahoo/adapter';

export const ADAPTERS: Record<ProviderId, ProviderAdapter<never>> = {
  sleeper: createSleeperAdapter(sleeperPlayers),
  yahoo: createYahooAdapter(async (c) => {
    await saveConnection(c);
  }),
  espn: espnAdapter,
  fleaflicker: fleaflickerAdapter,
  fantrax: createFantraxAdapter(fantraxPlayers),
};

/** In the order the Leagues screen lists them. */
export const PROVIDER_ORDER: ProviderId[] = ['sleeper', 'yahoo', 'espn', 'fantrax', 'fleaflicker'];

export function adapterFor<C extends Connection>(c: C): ProviderAdapter<C> {
  return ADAPTERS[c.provider] as unknown as ProviderAdapter<C>;
}
