/**
 * Background refresh: the OS wakes the app now and then (at best every 15
 * minutes, usually less often) to re-read visible leagues, so alerts can fire
 * with the app closed.
 *
 * The task must be defined at module scope, before React mounts — this file is
 * imported from app/_layout.tsx for that reason.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { startAlerts } from '@/lib/alerts';
import { currentPrefs, loadPrefs } from '@/lib/storage/prefs';
import { cachedLeagues, fetchSnapshot } from '@/src/sports/hub';
import { visibleOnHome } from '@/src/sports/prefs';

export const REFRESH_TASK = 'bitfantasy-refresh';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

if (supported) {
  TaskManager.defineTask(REFRESH_TASK, async () => {
    try {
      startAlerts();
      await loadPrefs();
      const leagues = visibleOnHome(await cachedLeagues(), currentPrefs());
      for (const l of leagues) await fetchSnapshot(l).catch(() => undefined);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function setBackgroundRefresh(on: boolean): Promise<void> {
  if (!supported) return;
  const registered = await TaskManager.isTaskRegisteredAsync(REFRESH_TASK);
  if (on && !registered) await BackgroundTask.registerTaskAsync(REFRESH_TASK, { minimumInterval: 30 });
  if (!on && registered) await BackgroundTask.unregisterTaskAsync(REFRESH_TASK);
}
