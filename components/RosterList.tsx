import { useRouter } from 'expo-router';
import React, { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { useInsights } from '@/lib/insights';
import { useSlate } from '@/lib/odds';
import { gameState, type GameState } from '@/src/betting/odds';
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
  // Re-read the scoreboard whenever the roster refreshes (every minute while open).
  const games = useSlate(snap.league.sport, snap.fetchedAt);
  const router = useRouter();
  const open = (p: RosterPlayer) =>
    router.push({
      pathname: '/player/[provider]/[id]/[playerId]',
      params: { provider: snap.league.provider, id: snap.league.id, playerId: p.id, team: roster.teamId },
    });
  const anyProj = Object.values(insights).some((i) => i.projection != null);
  const anyPts = roster.players.some((p) => p.points != null);
  const projSource = Object.values(insights).find((i) => i.projectionSource)?.projectionSource;

  return (
    <Card>
      <View style={st.legendRow}>
        {anyPts || anyProj ? (
          <Text style={st.legend}>{`Right: ${anyPts ? 'points so far' : ''}${anyPts && anyProj ? ', projected under' : anyProj ? 'projected points' : ''}${anyProj && projSource ? ` (${projSource})` : ''}`}</Text>
        ) : null}
        <Image source={require('@/assets/brand/scroll.png')} style={st.scrollSm} />
        <Text style={st.legend}>fresh news</Text>
      </View>
      {GROUPS.map(([slot, title]) => {
        const ps = roster.players.filter((p) => p.slot === slot);
        if (!ps.length) return null;
        const total = slot === 'starter' && anyProj ? ps.reduce((n, p) => n + (insights[p.id]?.projection ?? 0), 0) : null;
        const scored =
          slot === 'starter' && anyPts
            ? ps.reduce((n, p) => {
                const st8 = gameState(games, p.proTeam, snap.league.sport).state;
                return n + (st8 === 'pre' || st8 === 'bye' ? 0 : p.points ?? 0);
              }, 0)
            : null;
        return (
          <View key={slot} style={{ marginBottom: 8 }}>
            <View style={st.grpRow}>
              <Text style={st.grp}>{title}</Text>
              {scored != null || total != null ? (
                <Text style={st.grp}>
                  {[scored != null ? `PTS ${scored.toFixed(1)}` : null, total != null ? `PROJ ${total.toFixed(1)}` : null].filter(Boolean).join('  ·  ')}
                </Text>
              ) : null}
            </View>
            {ps.map((p) => (
              <PlayerRow key={`${slot}-${p.id}`} p={p} i={insights[p.id]} g={gameState(games, p.proTeam, snap.league.sport)} onPress={() => open(p)} />
            ))}
          </View>
        );
      })}
    </Card>
  );
}

type Game = ReturnType<typeof gameState>;

/** Kickoff in the phone's time: "Sun 1:00 PM". */
function kickoff(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const PlayerRow = memo(function PlayerRow({ p, i, g, onPress }: { p: RosterPlayer; i: PlayerInsight | undefined; g: Game; onPress: () => void }) {
  const state: GameState = g.state;
  // Before kickoff (or on a bye) a provider's 0 is not a score.
  const showPoints = p.points != null && state !== 'pre' && state !== 'bye';
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
      <View style={st.ptsCol}>
        {state === 'bye' ? (
          <Text style={st.bye}>BYE</Text>
        ) : showPoints ? (
          <>
            <Text style={st.pts}>{p.points!.toFixed(1)}</Text>
            <Text style={[st.projSm, state === 'live' && st.liveT]}>
              {state === 'live' ? '● LIVE' : state === 'final' ? 'FINAL' : i?.projection != null ? `proj ${i.projection.toFixed(1)}` : ''}
            </Text>
          </>
        ) : (
          <>
            <Text style={[st.proj, i?.projection == null && st.projNone]}>{i?.projection != null ? i.projection.toFixed(1) : '—'}</Text>
            {state === 'pre' && g.game ? <Text style={st.projSm}>{kickoff(g.game.startsAt)}</Text> : null}
          </>
        )}
      </View>
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
    ptsCol: { width: 74, alignItems: 'flex-end' },
    pts: { fontSize: 15, fontFamily: fonts.bodyBold, color: colors.accent },
    projSm: { fontSize: 10.5, color: colors.textDim, fontFamily: fonts.body, marginTop: 1 },
    liveT: { color: colors.loss, fontFamily: fonts.bodySemi },
    bye: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1 },
    proj: { textAlign: 'right', fontSize: 14, fontFamily: fonts.bodySemi, color: colors.textMuted },
    projNone: { color: colors.textDim },
  })
);
