import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { Silkscreen_400Regular, Silkscreen_700Bold } from '@expo-google-fonts/silkscreen';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
// Defines the background refresh task; it must exist before React mounts.
import '@/lib/background';
import { onAlertTap, startAlerts } from '@/lib/alerts';
import { healthCheckIfDue } from '@/lib/storage/health';
import { loadOddsSetting } from '@/lib/odds';
import { loadPrefs, restoreAccent } from '@/lib/storage/prefs';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  // Silkscreen for pixel labels, Inter for body. Hold the first frame until
  // both load so labels never reflow from the system font.
  const [fonts] = useFonts({
    Silkscreen_400Regular,
    Silkscreen_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // The accent and league prefs are read before the first screen paints, so
  // nothing flashes the default colour or a hidden league. Both are local
  // reads — no network on the launch path.
  const [prefsReady, setPrefsReady] = useState(false);
  const router = useRouter();
  useEffect(
    () =>
      onAlertTap((provider, id) =>
        router.push({ pathname: '/league/[provider]/[id]', params: { provider, id } })
      ),
    [router]
  );
  useEffect(() => {
    Promise.all([restoreAccent(), loadPrefs(), loadOddsSetting()])
      .catch(() => undefined)
      .finally(() => setPrefsReady(true));
    // The API watch, at most once a day, in the background.
    healthCheckIfDue();
    // Every league refresh feeds the 128bit feed and, if on, game-day alerts.
    startAlerts();
  }, []);

  if (!fonts || !prefsReady) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade_from_bottom' }} />
    </>
  );
}
