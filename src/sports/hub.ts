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
  return {
    leagues: kept,
    errors: results.filter((r) => r.error).map((r) => ({ provider: r.provider, message: r.error! })),
  };
}

export async function cachedSnapshot(l: Pick<League, 'provider' | 'id'>): Promise<LeagueSnapshot | null> {
  return getJsonItem<LeagueSnapshot>(snapKey(l));
}

export async function fetchSnapshot(league: League, signal?: AbortSignal): Promise<LeagueSnapshot> {
  const conn = (await getConnections()).find((c) => c.provider === league.provider);
  if (!conn) throw new Error(`Connect ${league.provider} again to refresh this league.`);
  const snap = await adapterFor(conn).snapshot(conn, league, signal);
  await setJsonItem(snapKey(league), snap);
  return snap;
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
