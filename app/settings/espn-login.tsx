import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EspnLoginView, espnLoginSupported } from '@/components/EspnLoginView';
import { Note, Screen } from '@/components/ui';
import { setJsonItem } from '@/lib/storage/kv';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { ESPN_LOGIN_KEY } from '@/src/providers/espn/login';

/**
 * ESPN's own sign-in page, inside the app. Once ESPN sets its two login
 * cookies (espn_s2 and SWID) we keep just those and close. The password is
 * typed into ESPN's page and never read or stored by this app.
 */
export default function EspnLogin() {
  const router = useRouter();
  const [status, setStatus] = useState('Sign in to ESPN below.');

  const onCookies = useCallback(
    async (c: { espnS2: string; swid: string }) => {
      setStatus('Signed in. Saving…');
      await setJsonItem(ESPN_LOGIN_KEY, { ...c, at: Date.now() });
      router.back();
    },
    [router]
  );

  if (!espnLoginSupported) {
    return (
      <Screen section="ESPN sign-in" back>
        <Note>ESPN sign-in works in the phone app. On the web, paste espn_s2 and SWID by hand.</Note>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 150 }}>
        <Screen section="ESPN sign-in" back>
          <Text style={st.status}>{status}</Text>
          <Text style={st.small}>Your password goes to ESPN only. 128BIT FANTASY keeps just the login cookie, in this phone&apos;s secure storage.</Text>
        </Screen>
      </View>
      <View style={st.web}>
        <EspnLoginView onCookies={onCookies} />
      </View>
    </View>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    status: { fontFamily: fonts.pixel, fontSize: 8, color: colors.accent, letterSpacing: 1, marginTop: 4 },
    small: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 6, lineHeight: 17 },
    web: { flex: 1, borderTopWidth: 1, borderTopColor: colors.border },
  })
);
