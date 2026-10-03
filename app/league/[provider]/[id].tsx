import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CoachesCornerButton } from '@/components/CoachesCornerButton';
import { LineupCheck } from '@/components/LineupCheck';
import { Card, CardHead, Empty, Label, Note, Screen } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, injuryColor, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { ageLabel, cachedLeagues, cachedSnapshot, fetchSnapshot } from '@/src/sports/hub';
import {
  formatRecord,
  matchupFor,
  sides,
  snapshotProblems,
  type LeagueSnapshot,
  type ProviderId,
  type RosterPlayer,
} from '@/src/sports/models';
import { lineupIssues } from '@/src/sports/lineup-check';
import { snapshotWithPrefs } from '@/src/sports/prefs';

/**
 * One league, seen from one team — yours by default. Tap any team in the
 * standings to look at it instead; Coaches Corner follows whichever team is
 * on screen.
 */
export default function LeagueScreen() {
  const { provider, id, team } = useLocalSearchParams<{ provider: ProviderId; id: string; team?: string }>();
  const router = useRouter();
  const prefs = usePrefs();
  const [raw, setRaw] = useState<LeagueSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(team ?? null);

  const refresh = useCallback(async () => {
    const league = (await cachedLeagues()).find((l) => l.provider === provider && l.id === id);
    if (!league) {
      setError('This league is no longer connected. Sign in again in Settings.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRaw(await fetchSnapshot(league));
    } catch (e) {
      setError(describeNetworkFailure(e, `the ${providerLabel(provider)} request`));
    } finally {
      setLoading(false);
    }
  }, [provider, id]);

  useEffect(() => {
    // Last known state first — instant — then live.
    cachedSnapshot({ provider, id }).then((s) => {
      if (s) setRaw(s);
      return refresh();
    });
  }, [provider, id, refresh]);

  if (!raw) {
    return (
      <Screen section="Team" back onRefresh={refresh} refreshing={loading}>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }

  const snap = snapshotWithPrefs(raw, prefs);
  const { league } = snap;
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const focusId = viewing ?? league.myTeamId;
  const focus = focusId ? teams.get(focusId) : undefined;
  const isMine = !!focusId && focusId === league.myTeamId;
  const roster = snap.rosters.find((r) => r.teamId === focusId);
  const m = matchupFor(snap, focusId);
  const [mine, opp] = m ? sides(m, focusId) : [null, null];
  const pts = (p: number | null | undefined) => (p == null ? '—' : p.toFixed(1));
  const problems = snapshotProblems(snap);
  const issues = lineupIssues(roster, league.sport);

  return (
    <Screen section={`${league.sport.toUpperCase()} · ${providerLabel(league.provider)}`} back onRefresh={refresh} refreshing={loading}>
      <Text style={st.title}>{focus?.name ?? league.name}</Text>
      <Text style={st.meta}>
        {[league.name, focus ? formatRecord(focus.record) : null, focus?.rank ? `#${focus.rank}` : null, league.scoring]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      <Text style={st.age}>{`UPDATED ${ageLabel(snap.fetchedAt).toUpperCase()}`}</Text>
      {!isMine && focus ? (
        <Pressable onPress={() => setViewing(null)}>
          <Text style={st.scout}>{league.myTeamId ? 'SCOUTING · TAP TO GO BACK TO YOUR TEAM' : 'VIEWING'}</Text>
        </Pressable>
      ) : null}
      {error ? <Note tone="error">{`${error} Showing the copy from ${ageLabel(snap.fetchedAt)}.`}</Note> : null}
      {problems.length ? (
        <Note tone="error">
          {`${providerLabel(league.provider)} sent data we couldn't fully read (${problems.join(', ')}). Its API may have changed — check Settings → Fantasy APIs.`}
        </Note>
      ) : null}

      {focusId ? (
        <CoachesCornerButton
          title={isMine ? 'COACHES CORNER' : `SCOUT ${focus?.name.toUpperCase() ?? 'THIS TEAM'}`}
          sub={isMine ? 'Your coach for this team — start/sit, waivers, trades, checked against today\'s news' : 'Coach sees this team plus yours, for matchups and trade ideas'}
          onPress={() =>
            router.push({ pathname: '/coach/[provider]/[id]/[team]', params: { provider: league.provider, id: league.id, team: focusId } })
          }
        />
      ) : (
        <Note>We couldn&apos;t tell which team is yours here. Tap your team in the standings, or pick it in Settings → My Teams.</Note>
      )}

      {focusId ? <LineupCheck league={league} teamId={focusId} issues={issues} mine={isMine} /> : null}

      {m && mine ? (
        <Card>
          <CardHead title={snap.period ? `WEEK ${snap.period}` : 'THIS PERIOD'} note={opp ? undefined : 'Bye'} />
          <View style={st.mu}>
            <View style={st.side}>
              <Text style={st.big}>{pts(mine.points)}</Text>
              <Text style={st.tn} numberOfLines={1}>{teams.get(mine.teamId)?.name ?? 'Team'}</Text>
            </View>
            <Text style={st.vs}>VS</Text>
            <Pressable style={[st.side, { alignItems: 'flex-end' }]} onPress={() => opp && setViewing(opp.teamId)}>
              <Text style={st.big}>{pts(opp?.points)}</Text>
              <Text style={st.tn} numberOfLines={1}>{opp ? teams.get(opp.teamId)?.name ?? 'Opponent' : '—'}</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {roster ? (
        <>
          <Label>ROSTER</Label>
          <Card>
            {(['starter', 'bench', 'ir', 'taxi'] as const).map((slot) => {
              const ps = roster.players.filter((p) => p.slot === slot);
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

      <Label>STANDINGS · TAP A TEAM TO VIEW IT</Label>
      <Card>
        {[...snap.teams]
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
          .map((t) => (
            <Pressable key={t.id} style={[st.srow, t.id === focusId && st.srowOn]} onPress={() => setViewing(t.id)}>
              <Text style={st.rank}>{t.rank ?? '–'}</Text>
              <Text style={[st.sname, t.id === league.myTeamId && { color: colors.accent }]} numberOfLines={1}>
                {t.name}
                {t.id === league.myTeamId ? '  (YOU)' : ''}
              </Text>
              <Text style={st.rec}>{formatRecord(t.record)}</Text>
              <Text style={st.pf}>{t.pointsFor == null ? '—' : t.pointsFor.toFixed(1)}</Text>
            </Pressable>
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

const st = themedStyles(() =>
  StyleSheet.create({
    title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4 },
    meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
    age: { fontFamily: fonts.pixel, fontSize: 7, color: colors.textDim, letterSpacing: 0.8, marginTop: 8 },
    scout: { fontFamily: fonts.pixel, fontSize: 8, color: colors.warn, letterSpacing: 1, marginTop: 10 },
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
    srow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, gap: 10, borderRadius: 8 },
    srowOn: { backgroundColor: colors.surfaceAlt },
    rank: { width: 22, fontFamily: fonts.pixel, fontSize: 9, color: colors.textDim },
    sname: { flex: 1, fontSize: 14, fontFamily: fonts.bodyMedium, color: colors.text },
    rec: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, width: 54, textAlign: 'right' },
    pf: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, width: 60, textAlign: 'right' },
  })
);
