/**
 * Game-day alerts: a local notification when a refresh finds something new —
 * a starter ruled out, an empty slot, a win or a loss.
 *
 * Local only. Nothing is sent to a server; the phone notices the change when
 * it refreshes (on open, on pull, or in the background task) and tells you.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { addEvents } from '@/lib/storage/feed';
import { getString, setString } from '@/lib/storage/kv';
import { currentPrefs, loadPrefs } from '@/lib/storage/prefs';
import { deriveEvents, shouldNotify, type FantasyEvent } from '@/src/sports/events';
import { onSnapshot } from '@/src/sports/hub';
import { leagueKey, snapshotWithPrefs } from '@/src/sports/prefs';

const KEY = 'alerts_enabled_v1';
const CHANNEL = 'gameday';

export const alertsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

if (alertsSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function alertsEnabled(): Promise<boolean> {
  return (await getString(KEY)) === '1';
}

/** Turns alerts on, asking for permission. Returns why not, or null when on. */
export async function enableAlerts(): Promise<string | null> {
  if (!alertsSupported) return 'Alerts work in the phone app, not the web version.';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Game day',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const res = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (!res.granted && res.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'Notifications are turned off for 128BIT FANTASY. Turn them on in your phone settings.';
  }
  await setString(KEY, '1');
  return null;
}

export async function disableAlerts(): Promise<void> {
  await setString(KEY, '0');
}

async function notify(e: FantasyEvent): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: e.title,
      body: e.body,
      data: { provider: e.league.provider, id: e.league.id, type: e.type },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

let started = false;

/**
 * Every refresh feeds the 128bit feed; new events also buzz the phone when
 * alerts are on. Hidden leagues stay quiet.
 */
export function startAlerts(): void {
  if (started) return;
  started = true;
  onSnapshot(async (prev, next) => {
    await loadPrefs();
    const prefs = currentPrefs();
    if (prefs.hidden.includes(leagueKey(next.league))) return;
    const events = deriveEvents(prev ? snapshotWithPrefs(prev, prefs) : null, snapshotWithPrefs(next, prefs));
    const fresh = await addEvents(events);
    if (!alertsSupported || !fresh.length || !(await alertsEnabled())) return;
    for (const e of fresh.filter(shouldNotify)) await notify(e);
  });
}

/** Tapping an alert opens that league's team screen. Returns the unsubscribe. */
export function onAlertTap(open: (provider: string, id: string) => void): () => void {
  if (!alertsSupported) return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const d = r.notification.request.content.data as { provider?: string; id?: string } | undefined;
    if (d?.provider && d.id) open(d.provider, d.id);
  });
  return () => sub.remove();
}
