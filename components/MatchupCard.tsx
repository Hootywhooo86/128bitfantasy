import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardHead } from '@/components/ui';
import { useInsightsFor } from '@/lib/insights';
import { colors, fonts, themedStyles } from '@/lib/theme';
import type { LeagueSnapshot, MatchupSide } from '@/src/sports/models';
import { teamTotals } from '@/src/sports/totals';

/**
 * This period's matchup: each side's points so far, big, and the starters'
 * projected total under it — what each team is on pace for.
 */
export function MatchupCard({
  snap,
  mine,
  opp,
  onOpen,
}: {
  snap: LeagueSnapshot;
  mine: MatchupSide;
  opp: MatchupSide | null;
  onOpen: (teamId: string) => void;
}) {
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const rosters = snap.rosters.filter((r) => r.teamId === mine.teamId || r.teamId === opp?.teamId);
  const insights = useInsightsFor(snap, rosters);
  const a = teamTotals(rosters.find((r) => r.teamId === mine.teamId), insights);
  const b = opp ? teamTotals(rosters.find((r) => r.teamId === opp.teamId), insights) : null;
  // The provider's team score wins; summed starters fill in when it has none.
  const score = (side: MatchupSide | null, t: typeof a | null) => side?.points ?? t?.points ?? null;
  const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1));
  const sa = score(mine, a);
  const sb = score(opp, b);
  const lead = sa != null && sb != null && (sa > 0 || sb > 0) ? sa - sb : null;

  return (
    <Card>
      <CardHead title={snap.period ? `WEEK ${snap.period}` : 'THIS PERIOD'} note={opp ? undefined : 'Bye'} />
      <View style={st.mu}>
        <Pressable style={st.side} onPress={() => onOpen(mine.teamId)}>
          <Text style={[st.big, lead != null && lead !== 0 && { color: lead > 0 ? colors.win : colors.loss }]}>{fmt(sa)}</Text>
          <Text style={st.proj}>{a.projected != null ? `proj ${fmt(a.projected)}` : ' '}</Text>
          <Text style={st.tn} numberOfLines={1}>{teams.get(mine.teamId)?.name ?? 'Team'}</Text>
        </Pressable>
        <Text style={st.vs}>VS</Text>
        <Pressable style={[st.side, { alignItems: 'flex-end' }]} onPress={() => opp && onOpen(opp.teamId)}>
          <Text style={st.big}>{fmt(sb)}</Text>
          <Text style={st.proj}>{b?.projected != null ? `proj ${fmt(b.projected)}` : ' '}</Text>
          <Text style={st.tn} numberOfLines={1}>{opp ? teams.get(opp.teamId)?.name ?? 'Opponent' : '—'}</Text>
        </Pressable>
      </View>
      {a.projected != null && b?.projected != null ? (
        <Text style={st.edge}>
          {a.projected === b.projected
            ? 'Projected dead even'
            : `Projected to ${a.projected > b.projected ? 'win' : 'lose'} by ${Math.abs(a.projected - b.projected).toFixed(1)}`}
        </Text>
      ) : null}
    </Card>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    mu: { flexDirection: 'row', alignItems: 'center' },
    side: { flex: 1 },
    big: { fontSize: 30, fontFamily: fonts.bodyBold, color: colors.text, letterSpacing: -0.8 },
    proj: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    tn: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, fontFamily: fonts.body },
    vs: { fontFamily: fonts.pixel, fontSize: 9, color: colors.textDim, marginHorizontal: 10 },
    edge: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 0.8, marginTop: 12, textAlign: 'center' },
  })
);
