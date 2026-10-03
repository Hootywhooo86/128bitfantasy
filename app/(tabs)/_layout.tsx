import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, fonts } from '@/lib/theme';

/** Pixel-type words, no icons, the active one in the accent — as in 128BIT FIT. */
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={[s.tab, focused && s.tabOn]}>{label}</Text>;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: '#080808',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 74,
          paddingTop: 10,
          elevation: 0,
        },
        tabBarShowLabel: false,
      }}
    >
      {(
        [
          ['index', 'HOME'],
          ['leagues', 'LEAGUES'],
          ['corner', 'COACH'],
        ] as const
      ).map(([name, label]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ tabBarIcon: ({ focused }) => <TabLabel label={label} focused={focused} /> }}
        />
      ))}
    </Tabs>
  );
}

const s = StyleSheet.create({
  tab: { fontFamily: fonts.pixel, fontSize: 11.5, letterSpacing: 1, color: colors.textDim, textAlign: 'center', width: 100 },
  tabOn: { color: colors.accent },
});
