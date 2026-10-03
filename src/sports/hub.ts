/**
 * The cross-provider view: every connected league, grouped by sport.
 *
 * League lists and snapshots are cached so the app opens on the last known
 * state with no signal, then refreshes. A cached snapshot always carries its
 * `fetchedAt` so the UI can say how old it is — stale data is never passed
 * off as live.
 */
import { getConnections } from '@/lib/storage/connections';
import { getJsonItem, setJsonItem } from '@/lib/storage/kv';
import { adapterFor } from '@/src/providers/registry';
import type { Connection } from '@/src/providers/types';
import type { League, LeagueSnapshot, ProviderId, Sport } from './models';

const LEAGUES_KEY = 'leagues_v1';
const SYNCED_KEY = 'leagues_synced_at_v1';
const snapKey = (l: Pick<League, 'provider' | 'id'>) => `snap_v1_${l.provider}_${l.id}`;

export type SyncResult = {
  leagues: League[];
  /** One line per provider that failed. The others still sync. */
  errors: { provider: ProviderId; message: string }[];
};

export async function cachedLeagues(): Promise<League[]> {
  return (await getJsonItem<League[]>(LEAGUES_KEY)) ?? [];
}

export async function syncLeagues(signal?: AbortSignal): Promise<SyncResult> {
  const conns = await getConnections();
  const previous = await cachedLeagues();
  const results = await Promise.all(
    conns.map(async (c: Connection) => {
      try {
        return { provider: c.provider, leagues: await adapterFor(c).listLeagues(c, signal), error: null };
      } catch (e) {
        return { provider: c.provider, leagues: null, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  const connected = new Set(conns.map((c) => c.provider));
  const leagues = results.flatMap((r) =>
    // A provider that failed keeps its last known leagues rather than vanishing.
    r.leagues ?? previous.filter((l) => l.provider === r.provider)
  );
  // Leagues from a provider that has since been disconnected are dropped.
  const kept = leagues.filter((l) => connected.has(l.provider));
  await setJsonItem(LEAGUES_KEY, kept);
  await setJsonItem(SYNCED_KEY, Date.now());
  return {
    leagues: kept,
    errors: results.filter((r) => r.error).map((r) => ({ provider: r.provider, message: r.error! })),
  };
}

export async function lastSyncedAt(): Promise<number | null> {
  return getJsonItem<number>(SYNCED_KEY);
}

export async function cachedSnapshot(l: Pick<League, 'provider' | 'id'>): Promise<LeagueSnapshot | null> {
  return getJsonItem<LeagueSnapshot>(snapKey(l));
}

/**
 * Requests already on the wire, by league. Home, the league screen and the
 * coach can all ask for the same league in the same second; they share one
 * fetch instead of tripling the wait and the rate-limit cost.
 */
const inFlight = new Map<string, Promise<LeagueSnapshot>>();

export function fetchSnapshot(league: League, signal?: AbortSignal): Promise<LeagueSnapshot> {
  const k = snapKey(league);
  const running = inFlight.get(k);
  if (running) return running;
  const p = (async () => {
    const conn = (await getConnections()).find((c) => c.provider === league.provider);
    if (!conn) throw new Error(`Connect ${league.provider} again in Settings to refresh this league.`);
    const snap = await adapterFor(conn).snapshot(conn, league, signal);
    await setJsonItem(k, snap);
    return snap;
  })().finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

/** Older than this, a cached snapshot is refreshed in the background when shown. */
export const STALE_MS = 5 * 60_000;

/**
 * Refreshes the given leagues' snapshots, a few at a time, skipping fresh
 * ones. Home calls this after painting from cache, so the screen is instant
 * and the numbers catch up a moment later.
 */
export async function refreshStale(
  leagues: League[],
  onSnapshot: (s: LeagueSnapshot) => void,
  now = Date.now()
): Promise<void> {
  const queue: League[] = [];
  for (const l of leagues) {
    const c = await cachedSnapshot(l);
    if (!c || now - c.fetchedAt > STALE_MS) queue.push(l);
  }
  const worker = async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      try {
        onSnapshot(await fetchSnapshot(l));
      } catch {
        // The card keeps its cached numbers and age; the league screen shows the error.
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export function groupBySport(leagues: League[]): Map<Sport, League[]> {
  const out = new Map<Sport, League[]>();
  for (const l of leagues) {
    const list = out.get(l.sport) ?? [];
    list.push(l);
    out.set(l.sport, list);
  }
  return out;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ageLabel(fetchedAt: number, now = Date.now()): string {
  const min = Math.floor((now - fetchedAt) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
