import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardHead } from '@/components/ui';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { teamUrl } from '@/src/providers/links';
import type { LineupIssue } from '@/src/sports/lineup-check';
import type { League } from '@/src/sports/models';

/**
 * Lineup problems for the team on screen, each with its healthy bench
 * options, and one button to fix it in the provider's own app.
 */
export function LineupCheck({ league, teamId, issues, mine }: { league: League; teamId: string; issues: LineupIssue[]; mine: boolean }) {
  const open = () => Linking.openURL(teamUrl(league, teamId)).catch(() => undefined);
  const where = providerLabel(league.provider);

  if (!issues.length) {
    return mine ? (
      <Card>
        <CardHead title="LINEUP CHECK" note="All clear" />
        <Text style={st.ok}>Every starter is healthy as far as {where} reports.</Text>
        <FixButton label={`OPEN IN ${where.toUpperCase()} ↗`} onPress={open} quiet />
      </Card>
    ) : null;
  }

  return (
    <Card style={{ borderColor: issues.some((i) => i.severity === 'bad') ? colors.loss : colors.warn }}>
      <CardHead title="LINEUP CHECK" note={`${issues.length} to look at`} />
      {issues.map((i) => (
        <View key={`${i.slot}-${i.player?.id ?? 'empty'}`} style={st.row}>
          <Text style={[st.dot, { color: i.severity === 'bad' ? colors.loss : colors.warn }]}>●</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.msg}>{`${i.slot ? `${i.slot}: ` : ''}${i.message}`}</Text>
            <Text style={st.opts}>
              {i.options.length
                ? `Healthy bench options: ${i.options.map((o) => o.name).join(', ')}`
                : 'No healthy bench player fits this slot — check waivers.'}
            </Text>
          </View>
        </View>
      ))}
      {mine ? <FixButton label={`FIX IN ${where.toUpperCase()} ↗`} onPress={open} /> : null}
      <Text style={st.note}>This app is read-only — the fix happens in {where}.</Text>
    </Card>
  );
}

function FixButton({ label, onPress, quiet }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.btn, quiet && st.btnQuiet, pressed && { opacity: 0.8 }]}>
      <Text style={[st.btnT, quiet && st.btnTQuiet]}>{label}</Text>
    </Pressable>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    ok: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body },
    row: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
    dot: { fontSize: 11, marginTop: 3 },
    msg: { fontSize: 14, color: colors.text, fontFamily: fonts.bodySemi },
    opts: { fontSize: 12.5, color: colors.textMuted, marginTop: 3, lineHeight: 18, fontFamily: fonts.body },
    btn: { marginTop: 12, backgroundColor: colors.accent, borderRadius: 9, paddingVertical: 12, alignItems: 'center' },
    btnQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderBright },
    btnT: { fontFamily: fonts.pixel, fontSize: 9.5, color: colors.onAccent, letterSpacing: 1 },
    btnTQuiet: { color: colors.text },
    note: { fontSize: 11.5, color: colors.textDim, marginTop: 8, fontFamily: fonts.body },
  })
);
