/**
 * Non-secret key/value storage: settings, cached leagues, cached snapshots.
 *
 * expo-sqlite's kv-store — SQLite on the phone, the same store 128BIT FIT keeps
 * its data in. Secrets never go here; see secure.ts.
 */
import Storage from 'expo-sqlite/kv-store';

/**
 * Parsed values, kept after the first read.
 *
 * Speed: a player catalog is a megabyte or more of JSON, and every league
 * screen used to read and parse it again. Now it is parsed once per launch
 * and every later read is a Map lookup. Writes update the cache first, so a
 * screen never reads back something older than what was just saved.
 */
const memory = new Map<string, unknown>();

export async function getJsonItem<T>(key: string): Promise<T | null> {
  if (memory.has(key)) return memory.get(key) as T | null;
  try {
    const raw = await Storage.getItemAsync(key);
    const value = raw ? (JSON.parse(raw) as T) : null;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export async function setJsonItem(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  await Storage.setItemAsync(key, JSON.stringify(value));
}

export async function removeItem(key: string): Promise<void> {
  memory.delete(key);
  await Storage.removeItemAsync(key);
}

export async function getString(key: string): Promise<string | null> {
  try {
    return await Storage.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setString(key: string, value: string): Promise<void> {
  await Storage.setItemAsync(key, value);
}
