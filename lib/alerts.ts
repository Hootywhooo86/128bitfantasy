/**
 * Game-day alerts: a local notification when a refresh finds something new —
 * a starter ruled out, an empty slot, a win or a loss.
 *
 * Local only. Nothing is sent to a server; the phone notices the change when
 * it refreshes (on open, on pull, or in the background task) and tells you.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { slateOdds } from '@/lib/odds';
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
    // The scoreboard says who plays today; without it, bench alerts just skip.
    const games = await slateOdds(next.league.sport).catch(() => []);
    const events = deriveEvents(prev ? snapshotWithPrefs(prev, prefs) : null, snapshotWithPrefs(next, prefs), Date.now(), games);
    const fresh = await addEvents(events);
    if (!alertsSupported || !fresh.length || !(await alertsEnabled())) return;
    const loud = fresh.filter(shouldNotify);
    for (const e of loud.filter((x) => x.type !== 'lineup.bench')) await notify(e);
    // Several bench players at once: one buzz for the league, not one each.
    const bench = loud.filter((x) => x.type === 'lineup.bench');
    if (bench.length === 1) await notify(bench[0]);
    else if (bench.length > 1) {
      await notify({
        ...bench[0],
        title: `${bench.length} bench players play while starting spots sit idle`,
        body: `${bench[0].league.name}: ${bench.map((b) => b.title.replace(/^Bench: (.*) plays (.*)$/, '$1 ($2)')).join(', ')}`,
      });
    }
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
