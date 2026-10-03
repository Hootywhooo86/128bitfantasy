import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/lib/theme';

/**
 * The family top bar: whistle + "128BIT FANTASY", the section name beneath in
 * pixel type. Same build as 128BIT FIT's so the apps read as one set.
 */
export function TopBar({
  section,
  onBack,
  right = 'gear',
}: {
  section: string;
  onBack?: () => void;
  right?: 'gear' | 'none';
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingTop: insets.top, height: 62 + insets.top }]}>
      <View style={s.side}>
        {onBack ? (
          <Pressable style={s.btn} onPress={onBack} hitSlop={8} accessibilityLabel="Back">
            <Text style={s.btnT}>‹</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={s.mid}>
        <View style={s.brand}>
          <Image source={require('@/assets/brand/logo-topbar.png')} style={s.logo} />
          <Text style={s.ttl}>128BIT FANTASY</Text>
        </View>
        <Text style={s.sub}>{section.toUpperCase()}</Text>
      </View>
      <View style={[s.side, s.right]}>
        {right === 'gear' ? (
          <Pressable style={s.btn} onPress={() => router.push('/settings')} hitSlop={8} accessibilityLabel="Settings">
            <Text style={s.btnT}>⚙</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 6,
  },
  side: { width: 54, alignItems: 'flex-start', justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  btnT: { color: colors.text, fontSize: 24, lineHeight: 28 },
  mid: { flex: 1, alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logo: { width: 24, height: 24 },
  ttl: { fontFamily: fonts.pixel, fontSize: 12.5, letterSpacing: 1, color: colors.text },
  sub: { fontFamily: fonts.pixel, fontSize: 9, color: colors.textDim, marginTop: 5, letterSpacing: 1.5 },
});
