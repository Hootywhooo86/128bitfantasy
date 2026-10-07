import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { CoachesCornerButton } from '@/components/CoachesCornerButton';
import { LineupCheck } from '@/components/LineupCheck';
import { MatchupCard } from '@/components/MatchupCard';
import { RosterList } from '@/components/RosterList';
import { Card, Empty, Label, Note, Screen } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { useSlate } from '@/lib/odds';
import { usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { ageLabel, cachedLeagues, cachedSnapshot, fetchSnapshot } from '@/src/sports/hub';
import {
  formatRecord,
  matchupFor,
  sides,
  snapshotProblems,
  type LeagueSnapshot,
  type ProviderId,
} from '@/src/sports/models';
import { benchStarts, lineupIssues } from '@/src/sports/lineup-check';
import { snapshotWithPrefs } from '@/src/sports/prefs';

/**
 * One league, seen from one team — yours by default. Tap any team in the
 * standings to look at it instead; Coaches Corner follows whichever team is
 * on screen.
 */
/** How often an open team screen re-reads live scores. */
const LIVE_REFRESH_MS = 60_000;

export default function LeagueScreen() {
  const { provider, id, team } = useLocalSearchParams<{ provider: ProviderId; id: string; team?: string }>();
  const router = useRouter();
  const prefs = usePrefs();
  const [raw, setRaw] = useState<LeagueSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(team ?? null);

  const refresh = useCallback(async (quiet = false) => {
    const league = (await cachedLeagues()).find((l) => l.provider === provider && l.id === id);
    if (!league) {
      setError('This league is no longer connected. Sign in again in Settings.');
      return;
    }
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setRaw(await fetchSnapshot(league));
    } catch (e) {
      setError(describeNetworkFailure(e, `the ${providerLabel(provider)} request`));
    } finally {
      setLoading(false);
    }
  }, [provider, id]);

  // Live points: while this screen is open, re-read every minute. Leaving the
  // screen stops it, so nothing polls in the background.
  useFocusEffect(
    useCallback(() => {
      const t = setInterval(() => {
        refresh(true);
      }, LIVE_REFRESH_MS);
      return () => clearInterval(t);
    }, [refresh])
  );

  useEffect(() => {
    // Last known state first — instant — then live.
    cachedSnapshot({ provider, id }).then((s) => {
      if (s) setRaw(s);
      return refresh();
    });
  }, [provider, id, refresh]);

  // Who plays today: for the "on your bench while a spot sits idle" check.
  const games = useSlate(raw?.league.sport, raw?.fetchedAt);

  if (!raw) {
    return (
      <Screen section="Team" back onRefresh={() => refresh()} refreshing={loading}>
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
  const problems = snapshotProblems(snap);
  const issues = lineupIssues(roster, league.sport);
  const bench = isMine ? benchStarts(roster, league.sport, games) : [];

  return (
    <Screen section={`${league.sport.toUpperCase()} · ${providerLabel(league.provider)}`} back onRefresh={() => refresh()} refreshing={loading}>
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

      {focusId ? <LineupCheck league={league} teamId={focusId} issues={issues} bench={bench} mine={isMine} onChanged={() => refresh(true)} /> : null}

      {m && mine ? <MatchupCard snap={snap} mine={mine} opp={opp} onOpen={setViewing} /> : null}

      {roster ? (
        <>
          <Label>ROSTER · TAP A PLAYER FOR NEWS</Label>
          <RosterList snap={raw} roster={roster} />
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
      {league.provider === 'yahoo' ? (
        // Required by Yahoo's API terms wherever its data is shown.
        <Text style={st.attrib} onPress={() => Linking.openURL('https://sports.yahoo.com/fantasy/').catch(() => undefined)}>
          Fantasy data provided by Yahoo Fantasy
        </Text>
      ) : null}
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    attrib: { fontSize: 11.5, color: colors.textDim, fontFamily: fonts.body, textAlign: 'center', marginTop: 12, textDecorationLine: 'underline' },
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
