import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, themedStyles } from '@/lib/theme';

/**
 * The Coaches Corner button: the whistle, big, in the accent. One tap and the
 * coach reads the internet and makes the call for this league.
 */
export function CoachesCornerButton({ onPress, title, sub }: { onPress: () => void; title?: string; sub?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.wrap, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Coaches Corner"
    >
      <View style={s.icon}>
        <Image source={require('@/assets/brand/logo.png')} style={s.logo} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.t}>{title ?? 'COACHES CORNER'}</Text>
        <Text style={s.sub}>{sub ?? 'AI checks injuries, news & matchups online — then makes the call'}</Text>
      </View>
      <Text style={s.arrow}>›</Text>
    </Pressable>
  );
}

const s = themedStyles(() => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    padding: 14,
    marginVertical: 10,
  },
  pressed: { backgroundColor: colors.surfaceAlt },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 36, height: 36 },
  t: { fontFamily: fonts.pixel, fontSize: 12, color: colors.accent, letterSpacing: 1.2 },
  sub: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, lineHeight: 17, fontFamily: fonts.body },
  arrow: { color: colors.accent, fontSize: 22 },
}));
