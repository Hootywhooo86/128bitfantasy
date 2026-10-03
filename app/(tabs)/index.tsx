import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CoachesCornerButton } from '@/components/CoachesCornerButton';
import { Card, Chips, Empty, Label, Note, Screen } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { colors, fonts } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { cachedLeagues, cachedSnapshot, groupBySport, syncLeagues } from '@/src/sports/hub';
import {
  SPORTS,
  formatRecord,
  myMatchup,
  sides,
  type League,
  type LeagueSnapshot,
  type Sport,
} from '@/src/sports/models';

type Filter = Sport | 'all';

export default function Home() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [snaps, setSnaps] = useState<Record<string, LeagueSnapshot | null>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const loadCached = useCallback(async () => {
    const ls = await cachedLeagues();
    setLeagues(ls);
    const entries = await Promise.all(ls.map(async (l) => [`${l.provider}:${l.id}`, await cachedSnapshot(l)] as const));
    setSnaps(Object.fromEntries(entries));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await syncLeagues();
      setErrors(res.errors.map((e) => `${providerLabel(e.provider)}: ${describeNetworkFailure(new Error(e.message), 'the sync')}`));
      await loadCached();
    } finally {
      setRefreshing(false);
    }
  }, [loadCached]);

  useFocusEffect(
    useCallback(() => {
      loadCached();
    }, [loadCached])
  );

  if (leagues === null) return <Screen section="Home">{null}</Screen>;

  const bySport = groupBySport(leagues);
  const chips: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: 'ALL', count: leagues.length },
    ...SPORTS.filter((sp) => bySport.has(sp.id)).map((sp) => ({ id: sp.id, label: sp.label, count: bySport.get(sp.id)!.length })),
  ];
  const shown = SPORTS.filter((sp) => (filter === 'all' || filter === sp.id) && bySport.has(sp.id));

  return (
    <Screen section="Home" onRefresh={refresh} refreshing={refreshing}>
      {leagues.length === 0 ? (
        <Empty
          title="NO LEAGUES YET"
          body="Connect Sleeper, Yahoo, ESPN, Fantrax or Fleaflicker and every team you run shows up here, sorted by sport."
          action={{ label: 'CONNECT A LEAGUE', onPress: () => router.push('/leagues') }}
        />
      ) : (
        <>
          <Chips items={chips} value={filter} onChange={setFilter} />
          <CoachesCornerButton onPress={() => router.push('/corner')} />
          {errors.map((e) => (
            <Note key={e} tone="error">{e}</Note>
          ))}
          {shown.map((sp) => (
            <View key={sp.id}>
              <Label>{sp.label}</Label>
              {bySport.get(sp.id)!.map((l) => (
                <LeagueCard
                  key={`${l.provider}:${l.id}`}
                  league={l}
                  snap={snaps[`${l.provider}:${l.id}`] ?? null}
                  onPress={() => router.push({ pathname: '/league/[provider]/[id]', params: { provider: l.provider, id: l.id } })}
                />
              ))}
            </View>
          ))}
          <Note>Pull down to sync every connected provider.</Note>
        </>
      )}
    </Screen>
  );
}

function LeagueCard({ league, snap, onPress }: { league: League; snap: LeagueSnapshot | null; onPress: () => void }) {
  const me = snap?.teams.find((t) => t.id === league.myTeamId);
  const m = snap ? myMatchup(snap) : null;
  const [mine, opp] = m ? sides(m, league.myTeamId) : [null, null];
  const oppName = opp ? snap?.teams.find((t) => t.id === opp.teamId)?.name : null;
  const pts = (p: number | null | undefined) => (p == null ? '—' : p.toFixed(1));
  const winning = mine?.points != null && opp?.points != null ? mine.points - opp.points : null;

  return (
    <Card onPress={onPress}>
      <View style={st.row}>
        <Text style={st.name} numberOfLines={1}>{league.name}</Text>
        <Text style={st.prov}>{providerLabel(league.provider).toUpperCase()}</Text>
      </View>
      <Text style={st.meta}>
        {[me ? `${me.name} · ${formatRecord(me.record)}` : null, me?.rank ? `#${me.rank}` : null, league.scoring]
          .filter(Boolean)
          .join('  ·  ') || 'Tap to load'}
      </Text>
      {m && opp ? (
        <View style={st.score}>
          <Text style={[st.pts, winning != null && { color: winning >= 0 ? colors.win : colors.loss }]}>{pts(mine?.points)}</Text>
          <Text style={st.vs} numberOfLines={1}>vs {oppName ?? 'opponent'}</Text>
          <Text style={st.pts}>{pts(opp.points)}</Text>
        </View>
      ) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15.5, fontFamily: fonts.bodySemi, color: colors.text },
  prov: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1 },
  meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
  score: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  pts: { fontSize: 20, fontFamily: fonts.bodyBold, color: colors.text, minWidth: 60 },
  vs: { flex: 1, textAlign: 'center', fontSize: 12, color: colors.textDim, fontFamily: fonts.body },
});
