import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardHead } from '@/components/ui';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { teamUrl } from '@/src/providers/links';
import { espnStart } from '@/src/providers/espn/write';
import { getConnection } from '@/lib/storage/connections';
import type { Connection } from '@/src/providers/types';
import { gameTime } from '@/src/sports/events';
import type { BenchStart, LineupIssue } from '@/src/sports/lineup-check';
import type { League } from '@/src/sports/models';

/**
 * Lineup problems for the team on screen, each with its healthy bench
 * options, and one button to fix it in the provider's own app.
 */
export function LineupCheck({
  league,
  teamId,
  issues,
  bench = [],
  mine,
  onChanged,
}: {
  league: League;
  teamId: string;
  issues: LineupIssue[];
  /** Bench players with a game to come while a spot they fit sits idle. */
  bench?: BenchStart[];
  mine: boolean;
  /** Called after a lineup change was made from here, to re-read the league. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  // ESPN in READ & WRITE: the fix can happen right here.
  const [espn, setEspn] = useState<Extract<Connection, { provider: 'espn' }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (league.provider !== 'espn' || !mine) return;
    getConnection('espn').then((c) => setEspn(c?.write ? c : null), () => undefined);
  }, [league.provider, mine]);
  const canWrite = !!espn && mine;
  const start = async (outId: string | null, slot: string, inId: string, name: string) => {
    if (!espn) return;
    setBusy(inId);
    setResult(null);
    try {
      await espnStart(espn, league, teamId, inId, outId, slot);
      setResult({ ok: true, text: `${name} is in your lineup on ESPN.` });
      onChanged?.();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const hosted = league.provider === 'bit128';
  const open = () =>
    hosted
      ? router.push({ pathname: '/hosted/[id]/lineup', params: { id: league.id } })
      : Linking.openURL(teamUrl(league, teamId)).catch(() => undefined);
  const where = providerLabel(league.provider);

  if (!issues.length && !bench.length) {
    return mine ? (
      <Card>
        <CardHead title="LINEUP CHECK" note="All clear" />
        <Text style={st.ok}>Every starter is healthy as far as {where} reports.</Text>
        <FixButton label={hosted ? 'SET LINEUP' : `OPEN IN ${where.toUpperCase()} ↗`} onPress={open} quiet />
      </Card>
    ) : null;
  }

  return (
    <Card style={{ borderColor: issues.some((i) => i.severity === 'bad') ? colors.loss : colors.warn }}>
      <CardHead title="LINEUP CHECK" note={`${issues.length + bench.length} to look at`} />
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
            {canWrite && i.options.length ? (
              <View style={st.starts}>
                {i.options.map((o) => (
                  <Pressable key={o.id} style={st.start} onPress={() => start(i.player?.id ?? null, i.slot, o.id, o.name)} disabled={!!busy}>
                    <Text style={st.startT}>{busy === o.id ? '…' : `START ${o.name.toUpperCase()}`}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {bench.map((b) => (
        <View key={`bench-${b.player.id}`} style={st.row}>
          <Text style={[st.dot, { color: colors.warn }]}>●</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.msg}>{`${b.slot}: ${b.player.name} plays ${gameTime(b.game.startsAt)}`}</Text>
            <Text style={st.opts}>{`On the bench while ${b.why}.`}</Text>
            {canWrite ? (
              <View style={st.starts}>
                <Pressable style={st.start} onPress={() => start(b.replaces?.id ?? null, b.slot, b.player.id, b.player.name)} disabled={!!busy}>
                  <Text style={st.startT}>{busy === b.player.id ? '…' : `START ${b.player.name.toUpperCase()}`}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {mine ? <FixButton label={hosted ? 'FIX MY LINEUP' : `FIX IN ${where.toUpperCase()} ↗`} onPress={open} /> : null}
      {result ? <Text style={[st.note, { color: result.ok ? colors.win : colors.loss }]}>{result.text}</Text> : null}
      {hosted ? null : canWrite ? (
        <Text style={st.note}>ESPN READ & WRITE is on (unofficial). If a change fails, make it on ESPN.</Text>
      ) : (
        <Text style={st.note}>This app is read-only for {where} — the fix happens there.</Text>
      )}
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
    starts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    start: { borderWidth: 1, borderColor: colors.accent, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 10 },
    startT: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.accent, letterSpacing: 0.6 },
  })
);
