/**
 * Secrets: the AI key, Yahoo tokens and app secret, ESPN cookies.
 *
 * Device keystore via expo-secure-store. Never logged. On web there is no
 * keystore, so values live in memory until the tab closes — and the caller is
 * told, rather than the save silently not surviving.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const memory = new Map<string, string>();

export class SecureStoreError extends Error {}

async function available(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function getSecret(key: string): Promise<string | null> {
  try {
    if (await available()) return await SecureStore.getItemAsync(key);
  } catch {
    // fall through to memory
  }
  return memory.get(key) ?? null;
}

/**
 * Saves and reads back. A keystore that is locked or full can report success
 * and store nothing; only the read-back tells those apart.
 */
export async function setSecret(key: string, value: string): Promise<void> {
  memory.set(key, value);
  if (!(await available())) {
    throw new SecureStoreError('This device has no secure keystore, so it is held only until the app closes.');
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    throw new SecureStoreError(`The device keystore refused it: ${e instanceof Error ? e.message : String(e)}`);
  }
  const back = await SecureStore.getItemAsync(key).catch(() => null);
  if (back !== value) throw new SecureStoreError('It did not survive being written to the device keystore.');
}

export async function deleteSecret(key: string): Promise<void> {
  memory.delete(key);
  try {
    if (await available()) await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}
