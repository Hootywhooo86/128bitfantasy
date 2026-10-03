/**
 * Connected provider accounts.
 *
 * A connection can hold tokens and cookies, so each one goes in the keystore
 * whole, one entry per provider. Small enough for every platform's limit.
 */
import type { Connection } from '@/src/providers/types';
import type { ProviderId } from '@/src/sports/models';
import { deleteSecret, getSecret, setSecret, SecureStoreError } from './secure';

const PROVIDERS: ProviderId[] = ['bit128', 'sleeper', 'yahoo', 'fantrax', 'espn', 'fleaflicker', 'mfl'];
const key = (p: ProviderId) => `bitfantasy_conn_${p}`;

export async function getConnection<P extends ProviderId>(
  p: P
): Promise<Extract<Connection, { provider: P }> | null> {
  const raw = await getSecret(key(p));
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Connection;
    return c.provider === p ? (c as Extract<Connection, { provider: P }>) : null;
  } catch {
    return null;
  }
}

export async function getConnections(): Promise<Connection[]> {
  const all = await Promise.all(PROVIDERS.map((p) => getConnection(p)));
  return all.filter((c): c is Connection => c !== null);
}

/**
 * Saves the connection. Returns a warning when it is held in memory only
 * (web), instead of throwing — the connection still works this session.
 */
export async function saveConnection(c: Connection): Promise<string | null> {
  try {
    await setSecret(key(c.provider), JSON.stringify(c));
    return null;
  } catch (e) {
    if (e instanceof SecureStoreError) return e.message;
    throw e;
  }
}

export async function removeConnection(p: ProviderId): Promise<void> {
  await deleteSecret(key(p));
}
