/**
 * Non-secret key/value storage: settings, cached leagues, cached snapshots.
 *
 * expo-sqlite's kv-store — SQLite on the phone, the same store 128BIT FIT keeps
 * its data in. Secrets never go here; see secure.ts.
 */
import Storage from 'expo-sqlite/kv-store';

export async function getJsonItem<T>(key: string): Promise<T | null> {
  try {
    const raw = await Storage.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setJsonItem(key: string, value: unknown): Promise<void> {
  await Storage.setItemAsync(key, JSON.stringify(value));
}

export async function removeItem(key: string): Promise<void> {
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
