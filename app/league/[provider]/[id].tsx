import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CoachesCornerButton } from '@/components/CoachesCornerButton';
import { Card, CardHead, Empty, Label, Note, Screen } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { colors, fonts, injuryColor } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { ageLabel, cachedLeagues, cachedSnapshot, fetchSnapshot } from '@/src/sports/hub';
import { formatRecord, myMatchup, sides, type LeagueSnapshot, type ProviderId, type RosterPlayer } from '@/src/sports/models';

export default function LeagueScreen() {
  const { provider, id } = useLocalSearchParams<{ provider: ProviderId; id: string }>();
  const router = useRouter();
  const [snap, setSnap] = useState<LeagueSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const league = (await cachedLeagues()).find((l) => l.provider === provider && l.id === id);
    if (!league) {
      setError('This league is no longer connected.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnap(await fetchSnapshot(league));
    } catch (e) {
      setError(describeNetworkFailure(e, `the ${providerLabel(provider)} request`));
    } finally {
      setLoading(false);
    }
  }, [provider, id]);

  useEffect(() => {
    // Last known state first, then live.
    cachedSnapshot({ provider, id }).then((s) => {
      if (s) setSnap(s);
      return refresh();
    });
  }, [provider, id, refresh]);

  if (!snap) {
    return (
      <Screen section="League" back onRefresh={refresh} refreshing={loading}>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }

  const { league } = snap;
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const me = league.myTeamId ? teams.get(league.myTeamId) : undefined;
  const myRoster = snap.rosters.find((r) => r.teamId === league.myTeamId);
  const m = myMatchup(snap);
  const [mine, opp] = m ? sides(m, league.myTeamId) : [null, null];
  const pts = (p: number | null | undefined) => (p == null ? '—' : p.toFixed(1));

  return (
    <Screen section={`${league.sport.toUpperCase()} · ${providerLabel(league.provider)}`} back onRefresh={refresh} refreshing={loading}>
      <Text style={st.title}>{league.name}</Text>
      <Text style={st.meta}>
        {[league.season, league.scoring, league.teamCount ? `${league.teamCount} teams` : null, `updated ${ageLabel(snap.fetchedAt)}`]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      {error ? <Note tone="error">{`${error} Showing the last copy from ${ageLabel(snap.fetchedAt)}.`}</Note> : null}

      <CoachesCornerButton
        onPress={() => router.push({ pathname: '/corner', params: { provider: league.provider, id: league.id } })}
        sub="Start/sit, waivers and trades for this league — checked against today's news"
      />

      {m && mine ? (
        <Card>
          <CardHead title={`${snap.period ? `WEEK ${snap.period}` : 'THIS PERIOD'}`} note={opp ? undefined : 'Bye'} />
          <View style={st.mu}>
            <View style={st.side}>
              <Text style={st.big}>{pts(mine.points)}</Text>
              <Text style={st.tn} numberOfLines={1}>{teams.get(mine.teamId)?.name ?? 'You'}</Text>
            </View>
            <Text style={st.vs}>VS</Text>
            <View style={[st.side, { alignItems: 'flex-end' }]}>
              <Text style={st.big}>{pts(opp?.points)}</Text>
              <Text style={st.tn} numberOfLines={1}>{opp ? teams.get(opp.teamId)?.name ?? 'Opponent' : '—'}</Text>
            </View>
          </View>
        </Card>
      ) : null}

      {!league.myTeamId ? (
        <Note>
          {league.provider === 'espn'
            ? "Add your SWID cookie in Leagues → ESPN so we know which team is yours."
            : "We couldn't tell which team is yours in this league."}
        </Note>
      ) : null}

      {myRoster ? (
        <>
          <Label>{me ? `${me.name.toUpperCase()} · ${formatRecord(me.record)}` : 'MY ROSTER'}</Label>
          <Card>
            {(['starter', 'bench', 'ir', 'taxi'] as const).map((slot) => {
              const ps = myRoster.players.filter((p) => p.slot === slot);
              if (!ps.length) return null;
              return (
                <View key={slot} style={{ marginBottom: 8 }}>
                  <Text style={st.grp}>{{ starter: 'STARTERS', bench: 'BENCH', ir: 'IR', taxi: 'TAXI / MINORS' }[slot]}</Text>
                  {ps.map((p) => (
                    <PlayerRow key={`${slot}-${p.id}`} p={p} />
                  ))}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <Label>STANDINGS</Label>
      <Card>
        {[...snap.teams]
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
          .map((t) => (
            <View key={t.id} style={st.srow}>
              <Text style={st.rank}>{t.rank ?? '–'}</Text>
              <Text style={[st.sname, t.id === league.myTeamId && { color: colors.accent }]} numberOfLines={1}>{t.name}</Text>
              <Text style={st.rec}>{formatRecord(t.record)}</Text>
              <Text style={st.pf}>{t.pointsFor == null ? '—' : t.pointsFor.toFixed(1)}</Text>
            </View>
          ))}
      </Card>
    </Screen>
  );
}

function PlayerRow({ p }: { p: RosterPlayer }) {
  return (
    <View style={st.prow}>
      <Text style={st.slot}>{p.lineupSlot ?? ''}</Text>
      <Text style={st.pname} numberOfLines={1}>{p.name}</Text>
      <Text style={st.pmeta}>{[p.position, p.proTeam].filter(Boolean).join(' · ')}</Text>
      {p.injury ? <Text style={[st.inj, { color: injuryColor(p.injury) }]}>{p.injury.slice(0, 3).toUpperCase()}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4 },
  meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
  mu: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1 },
  big: { fontSize: 30, fontFamily: fonts.bodyBold, color: colors.text, letterSpacing: -0.8 },
  tn: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, fontFamily: fonts.body },
  vs: { fontFamily: fonts.pixel, fontSize: 9, color: colors.textDim, marginHorizontal: 10 },
  grp: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1.2, marginVertical: 6 },
  prow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  slot: { width: 44, fontFamily: fonts.pixel, fontSize: 8, color: colors.accent, letterSpacing: 0.5 },
  pname: { flex: 1, fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
  pmeta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body },
  inj: { fontFamily: fonts.pixel, fontSize: 8, letterSpacing: 0.5, width: 30, textAlign: 'right' },
  srow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  rank: { width: 22, fontFamily: fonts.pixel, fontSize: 9, color: colors.textDim },
  sname: { flex: 1, fontSize: 14, fontFamily: fonts.bodyMedium, color: colors.text },
  rec: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, width: 54, textAlign: 'right' },
  pf: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, width: 60, textAlign: 'right' },
});
