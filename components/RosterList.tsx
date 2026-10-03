import { useRouter } from 'expo-router';
import React, { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { useInsights } from '@/lib/insights';
import { colors, fonts, themedStyles } from '@/lib/theme';
import type { PlayerInsight } from '@/src/sports/insights';
import type { LeagueSnapshot, Roster, RosterPlayer } from '@/src/sports/models';

const GROUPS = [
  ['starter', 'STARTERS'],
  ['bench', 'BENCH'],
  ['ir', 'IR'],
  ['taxi', 'TAXI / MINORS'],
] as const;

/**
 * A roster by slot, each player with: injury tag (Q / D / O / IR…), the news
 * scroll when there is fresh news, and projected points. Tap for the full
 * story.
 */
export function RosterList({ snap, roster }: { snap: LeagueSnapshot; roster: Roster }) {
  const insights = useInsights(snap, roster);
  const router = useRouter();
  const open = (p: RosterPlayer) =>
    router.push({
      pathname: '/player/[provider]/[id]/[playerId]',
      params: { provider: snap.league.provider, id: snap.league.id, playerId: p.id, team: roster.teamId },
    });
  const anyProj = Object.values(insights).some((i) => i.projection != null);
  const projSource = Object.values(insights).find((i) => i.projectionSource)?.projectionSource;

  return (
    <Card>
      <View style={st.legendRow}>
        {anyProj ? <Text style={st.legend}>{`Right column: projected points${projSource ? ` (${projSource})` : ''}`}</Text> : null}
        <Image source={require('@/assets/brand/scroll.png')} style={st.scrollSm} />
        <Text style={st.legend}>fresh news</Text>
      </View>
      {GROUPS.map(([slot, title]) => {
        const ps = roster.players.filter((p) => p.slot === slot);
        if (!ps.length) return null;
        const total = slot === 'starter' && anyProj ? ps.reduce((n, p) => n + (insights[p.id]?.projection ?? 0), 0) : null;
        return (
          <View key={slot} style={{ marginBottom: 8 }}>
            <View style={st.grpRow}>
              <Text style={st.grp}>{title}</Text>
              {total != null ? <Text style={st.grp}>{`PROJ ${total.toFixed(1)}`}</Text> : null}
            </View>
            {ps.map((p) => (
              <PlayerRow key={`${slot}-${p.id}`} p={p} i={insights[p.id]} onPress={() => open(p)} />
            ))}
          </View>
        );
      })}
    </Card>
  );
}

const PlayerRow = memo(function PlayerRow({ p, i, onPress }: { p: RosterPlayer; i: PlayerInsight | undefined; onPress: () => void }) {
  const tagColor = i?.level === 'questionable' ? colors.warn : i?.level === 'doubtful' ? '#ff9a3d' : colors.loss;
  return (
    <Pressable style={({ pressed }) => [st.prow, pressed && { backgroundColor: colors.surfaceAlt }]} onPress={onPress}>
      <Text style={st.slot}>{p.lineupSlot ?? ''}</Text>
      <View style={st.nameCol}>
        <View style={st.nameRow}>
          <Text style={st.pname} numberOfLines={1}>{p.name}</Text>
          {i?.tag ? (
            <View style={[st.tag, { borderColor: tagColor }]}>
              <Text style={[st.tagT, { color: tagColor }]}>{i.tag}</Text>
            </View>
          ) : null}
          {i?.hasNews ? <Image source={require('@/assets/brand/scroll.png')} style={st.scroll} accessibilityLabel="Fresh news" /> : null}
        </View>
        <Text style={st.pmeta} numberOfLines={1}>
          {[p.position, p.proTeam, i?.detail].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={[st.proj, i?.projection == null && st.projNone]}>{i?.projection != null ? i.projection.toFixed(1) : '—'}</Text>
    </Pressable>
  );
});

const st = themedStyles(() =>
  StyleSheet.create({
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 4 },
    legend: { fontSize: 11, color: colors.textDim, fontFamily: fonts.body },
    scrollSm: { width: 12, height: 12, marginLeft: 6 },
    grpRow: { flexDirection: 'row', justifyContent: 'space-between' },
    grp: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1.2, marginVertical: 6 },
    prow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    slot: { width: 40, fontFamily: fonts.pixel, fontSize: 8, color: colors.accent, letterSpacing: 0.5 },
    nameCol: { flex: 1, minWidth: 0 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pname: { flexShrink: 1, fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    tag: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    tagT: { fontFamily: fonts.pixel, fontSize: 7.5, letterSpacing: 0.5 },
    scroll: { width: 16, height: 16 },
    pmeta: { fontSize: 11.5, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    proj: { width: 44, textAlign: 'right', fontSize: 14, fontFamily: fonts.bodySemi, color: colors.text },
    projNone: { color: colors.textDim },
  })
);
