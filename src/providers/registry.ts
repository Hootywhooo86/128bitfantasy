/**
 * Every provider, wired to its storage-backed helpers.
 *
 * The adapters themselves are pure (fetch in, normalized models out); this is
 * the one place that hands them the player caches and the token saver.
 */
import { hostedAdapter } from '@/lib/leagues/adapter';
import { saveConnection } from '@/lib/storage/connections';
import { fantraxPlayers, mflPlayers, sleeperPlayers } from '@/lib/storage/player-cache';
import type { ProviderId } from '@/src/sports/models';
import { espnAdapter } from './espn/adapter';
import { createFantraxAdapter } from './fantrax/adapter';
import { fleaflickerAdapter } from './fleaflicker/adapter';
import { createMflAdapter } from './mfl/adapter';
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
  mfl: createMflAdapter(mflPlayers),
  bit128: hostedAdapter,
};

/** Outside fantasy sites, in the order the sign-in list shows them. */
export const PROVIDER_ORDER: ProviderId[] = ['sleeper', 'yahoo', 'espn', 'mfl', 'fantrax', 'fleaflicker'];

/** Everything, including leagues this app hosts itself. */
export const ALL_PROVIDERS: ProviderId[] = ['bit128', ...PROVIDER_ORDER];

export function adapterFor<C extends Connection>(c: C): ProviderAdapter<C> {
  return ADAPTERS[c.provider] as unknown as ProviderAdapter<C>;
}
