/**
 * Persisted preferences: league visibility, picked teams, accent colour.
 *
 * Held in memory after the first read and published to subscribers, so every
 * screen sees a change at once without re-reading storage.
 */
import { useSyncExternalStore } from 'react';
import { applyAccent, DEFAULT_ACCENT } from '@/lib/accent';
import { EMPTY_PREFS, type LeaguePrefs } from '@/src/sports/prefs';
import { getJsonItem, getString, setJsonItem, setString } from './kv';

const PREFS_KEY = 'league_prefs_v1';
const ACCENT_KEY = 'accent_v1';

let prefs: LeaguePrefs = EMPTY_PREFS;
let loaded: Promise<LeaguePrefs> | null = null;
const listeners = new Set<() => void>();

export function loadPrefs(): Promise<LeaguePrefs> {
  loaded ??= getJsonItem<LeaguePrefs>(PREFS_KEY).then((p) => {
    prefs = { ...EMPTY_PREFS, ...(p ?? {}) };
    for (const l of [...listeners]) l();
    return prefs;
  });
  return loaded;
}

export async function updatePrefs(fn: (p: LeaguePrefs) => LeaguePrefs): Promise<void> {
  await loadPrefs();
  prefs = fn(prefs);
  for (const l of [...listeners]) l();
  await setJsonItem(PREFS_KEY, prefs);
}

export function usePrefs(): LeaguePrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
    () => prefs
  );
}

export const currentPrefs = () => prefs;

/** Reads the saved accent and applies it. Called once at launch. */
export async function restoreAccent(): Promise<void> {
  applyAccent((await getString(ACCENT_KEY)) ?? DEFAULT_ACCENT);
}

export async function saveAccent(hex: string): Promise<void> {
  applyAccent(hex);
  await setString(ACCENT_KEY, hex);
}
