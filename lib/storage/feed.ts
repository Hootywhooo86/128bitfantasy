/**
 * The 128bit feed on this phone: events derived from league refreshes,
 * newest first, capped, deduplicated by id.
 */
import { useSyncExternalStore } from 'react';
import type { FantasyEvent } from '@/src/sports/events';
import { getJsonItem, setJsonItem } from './kv';

const KEY = 'feed_v1';
const CAP = 200;

let feed: FantasyEvent[] = [];
let loaded = false;
const listeners = new Set<() => void>();

export async function loadFeed(): Promise<FantasyEvent[]> {
  if (!loaded) {
    feed = (await getJsonItem<FantasyEvent[]>(KEY)) ?? [];
    loaded = true;
  }
  return feed;
}

/** Adds the events not already in the feed and returns only those — the new ones. */
export async function addEvents(events: FantasyEvent[]): Promise<FantasyEvent[]> {
  if (!events.length) return [];
  await loadFeed();
  const seen = new Set(feed.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  if (!fresh.length) return [];
  feed = [...fresh, ...feed].slice(0, CAP);
  for (const l of [...listeners]) l();
  await setJsonItem(KEY, feed);
  return fresh;
}

export function useFeed(): FantasyEvent[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => feed,
    () => feed
  );
}
