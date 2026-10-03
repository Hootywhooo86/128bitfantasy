/**
 * The last API watch report, and the once-a-day automatic run.
 */
import { Platform } from 'react-native';
import { checkApis, type HealthReport } from '@/src/providers/health';
import { getJsonItem, setJsonItem } from './kv';

const KEY = 'api_health_v1';
const DAY = 24 * 60 * 60 * 1000;

export function lastHealth(): Promise<HealthReport | null> {
  return getJsonItem<HealthReport>(KEY);
}

export async function runHealthCheck(signal?: AbortSignal): Promise<HealthReport> {
  const r = await checkApis(signal);
  await setJsonItem(KEY, r);
  return r;
}

/**
 * Browsers block cross-site reads from Yahoo, Fantrax and Fleaflicker (no
 * CORS headers), so from the web build those would all read as "down" when
 * they are fine. The check is a phone feature; the web says so instead.
 */
export const canCheckApis = Platform.OS !== 'web';

/** Runs the check if the last one is more than a day old. Never throws. */
export async function healthCheckIfDue(): Promise<HealthReport | null> {
  if (!canCheckApis) return null;
  const last = await lastHealth();
  if (last && Date.now() - last.checkedAt < DAY) return last;
  return runHealthCheck().catch(() => last);
}
