import { useFocusEffect, useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Chips, Empty, Label, Note, Screen } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { lastHealth } from '@/lib/storage/health';
import { usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import type { HealthReport } from '@/src/providers/health';
import { ageLabel, cachedLeagues, cachedSnapshot, groupBySport, lastSyncedAt, refreshStale, syncLeagues } from '@/src/sports/hub';
import { SPORTS, formatRecord, myMatchup, sides, type League, type LeagueSnapshot, type Sport } from '@/src/sports/models';
import { issueSummary, lineupIssues } from '@/src/sports/lineup-check';
import { teamTotals } from '@/src/sports/totals';
import { useInsightsFor } from '@/lib/insights';
import { leagueKey, needsTeamPick, snapshotWithPrefs, visibleOnHome } from '@/src/sports/prefs';

type Filter = Sport | 'all';

/** Leagues re-sync on open when the last sync is older than this. */
const RESYNC_MS = 15 * 60_000;

export default function Home() {
  const router = useRouter();
  const prefs = usePrefs();
  const [all, setAll] = useState<League[] | null>(null);
  const [snaps, setSnaps] = useState<Record<string, LeagueSnapshot | null>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [health, setHealth] = useState<HealthReport | null>(null);

  const putSnap = useCallback((s: LeagueSnapshot) => setSnaps((x) => ({ ...x, [leagueKey(s.league)]: s })), []);

  // Paint from cache first: no spinner on open, ever.
  const loadCached = useCallback(async () => {
    const ls = await cachedLeagues();
    setAll(ls);
    const entries = await Promise.all(ls.map(async (l) => [leagueKey(l), await cachedSnapshot(l)] as const));
    setSnaps(Object.fromEntries(entries));
    setHealth(await lastHealth());
    return ls;
  }, []);

  const sync = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await syncLeagues();
      setErrors(res.errors.map((e) => `${providerLabel(e.provider)}: ${describeNetworkFailure(new Error(e.message), 'the sync')}`));
      const ls = await loadCached();
      await refreshStale(visibleOnHome(ls, prefs), putSnap, Date.now() + 10 * 60_000);
    } finally {
      setRefreshing(false);
    }
  }, [loadCached, putSnap, prefs]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadCached().then(async (ls) => {
        if (!live) return;
        // Then catch up in the background: league list if it's old, scores if stale.
        const synced = await lastSyncedAt();
        if (!synced || Date.now() - synced > RESYNC_MS) await syncLeagues().catch(() => undefined);
        const fresh = await cachedLeagues();
        if (live) setAll(fresh);
        refreshStale(visibleOnHome(fresh, prefs), (s) => live && putSnap(s));
      });
      return () => {
        live = false;
      };
    }, [loadCached, putSnap, prefs])
  );

  // A newly picked team shows up without waiting for a sync.
  useEffect(() => {
    if (all) refreshStale(visibleOnHome(all, prefs), putSnap);
  }, [prefs, all, putSnap]);

  if (all === null) return <Screen section="Home">{null}</Screen>;

  const leagues = visibleOnHome(all, prefs);
  const toPick = needsTeamPick(all, prefs);
  const changed = health ? Object.entries(health.results).filter(([, h]) => h.status === 'changed') : [];
  const bySport = groupBySport(leagues);
  const chips: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: 'ALL', count: leagues.length },
    ...SPORTS.filter((sp) => bySport.has(sp.id)).map((sp) => ({ id: sp.id, label: sp.label, count: bySport.get(sp.id)!.length })),
  ];
  const shown = SPORTS.filter((sp) => (filter === 'all' || filter === sp.id) && bySport.has(sp.id));

  return (
    <Screen section="My Teams" onRefresh={sync} refreshing={refreshing}>
      {changed.length ? (
        <Card onPress={() => router.push('/settings')} style={{ borderColor: colors.warn }}>
          <Text style={st.warnT}>API CHANGE SPOTTED</Text>
          <Text style={st.warnB}>
            {changed.map(([p]) => providerLabel(p as League['provider'])).join(', ')} answered differently than expected. Some
            numbers may be missing until the app is updated. Details in Settings.
          </Text>
        </Card>
      ) : null}

      {all.length === 0 ? (
        <Empty
          title="NO TEAMS YET"
          body="Sign in to Sleeper, Yahoo, ESPN, MyFantasyLeague, Fantrax or Fleaflicker in Settings and every team you run shows up here, sorted by sport."
          action={{ label: 'SIGN IN', onPress: () => router.push('/settings') }}
        />
      ) : (
        <>
          {toPick.length ? (
            <Card onPress={() => router.push('/settings/teams')}>
              <Text style={st.warnT}>{`PICK YOUR TEAM IN ${toPick.length} LEAGUE${toPick.length === 1 ? '' : 'S'}`}</Text>
              <Text style={st.warnB}>
                {toPick.map((l) => l.name).join(', ')} — we couldn&apos;t tell which team is yours. Tap to choose, or hide them.
              </Text>
            </Card>
          ) : null}

          {leagues.length > 1 ? <Chips items={chips} value={filter} onChange={setFilter} /> : null}
          {errors.map((e) => (
            <Note key={e} tone="error">{e}</Note>
          ))}
          {leagues.length === 0 && !toPick.length ? (
            <Empty title="ALL HIDDEN" body="Every league is hidden. Choose which teams to show in Settings → My Teams." />
          ) : null}
          {shown.map((sp) => (
            <View key={sp.id}>
              <Label>{sp.label}</Label>
              {bySport.get(sp.id)!.map((l) => {
                const k = leagueKey(l);
                const snap = snaps[k];
                return (
                  <TeamCard key={k} league={l} snap={snap ? snapshotWithPrefs(snap, prefs) : null} />
                );
              })}
            </View>
          ))}
          <Note>Pull down to sync. Open a team for its Coaches Corner.</Note>
        </>
      )}
    </Screen>
  );
}

/** Memoised: a background refresh of one league re-renders one card, not the list. */
const TeamCard = memo(function TeamCard({ league, snap }: { league: League; snap: LeagueSnapshot | null }) {
  const router = useRouter();
  const onPress = () => router.push({ pathname: '/league/[provider]/[id]', params: { provider: league.provider, id: league.id } });
  const me = snap?.teams.find((t) => t.id === league.myTeamId);
  const m = snap ? myMatchup(snap) : null;
  const [mine, opp] = m ? sides(m, league.myTeamId) : [null, null];
  const oppName = opp ? snap?.teams.find((t) => t.id === opp.teamId)?.name : null;
  const pts = (p: number | null | undefined) => (p == null ? '—' : p.toFixed(1));
  const diff = mine?.points != null && opp?.points != null ? mine.points - opp.points : null;
  const oppId = opp?.teamId ?? null;
  const myId = league.myTeamId;
  const rosters = snap ? snap.rosters.filter((r) => r.teamId === myId || r.teamId === oppId) : null;
  const insights = useInsightsFor(snap, rosters);
  const mineT = teamTotals(rosters?.find((r) => r.teamId === league.myTeamId), insights);
  const oppT = opp ? teamTotals(rosters?.find((r) => r.teamId === opp.teamId), insights) : null;
  const flag = snap ? issueSummary(lineupIssues(snap.rosters.find((r) => r.teamId === league.myTeamId), league.sport)) : null;

  return (
    <Card onPress={onPress}>
      <View style={st.row}>
        <Text style={st.name} numberOfLines={1}>{me?.name ?? league.name}</Text>
        <Text style={st.prov}>{providerLabel(league.provider).toUpperCase()}</Text>
      </View>
      <Text style={st.meta} numberOfLines={1}>
        {[league.name, me ? formatRecord(me.record) : null, me?.rank ? `#${me.rank}` : null].filter(Boolean).join('  ·  ')}
      </Text>
      {m && opp ? (
        <View style={st.score}>
          <Text style={[st.pts, diff != null && { color: diff >= 0 ? colors.win : colors.loss }]}>{pts(mine?.points)}</Text>
          <Text style={st.vs} numberOfLines={1}>vs {oppName ?? 'opponent'}</Text>
          <Text style={[st.pts, { textAlign: 'right' }]}>{pts(opp.points)}</Text>
        </View>
      ) : null}
      {mineT.projected != null ? (
        <Text style={st.projLine}>
          {`proj ${mineT.projected.toFixed(1)}${oppT?.projected != null ? ` vs ${oppT.projected.toFixed(1)}` : ''}`}
        </Text>
      ) : null}
      {flag ? <Text style={[st.flag, { color: flag.severity === 'bad' ? colors.loss : colors.warn }]}>{`● ${flag.text}`}</Text> : null}
      {snap ? <Text style={st.age}>{`updated ${ageLabel(snap.fetchedAt)}`}</Text> : <Text style={st.age}>loading…</Text>}
    </Card>
  );
});

const st = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    name: { flex: 1, fontSize: 16, fontFamily: fonts.bodySemi, color: colors.text },
    prov: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.accent, letterSpacing: 1 },
    meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
    score: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
    pts: { fontSize: 20, fontFamily: fonts.bodyBold, color: colors.text, minWidth: 64 },
    vs: { flex: 1, textAlign: 'center', fontSize: 12, color: colors.textDim, fontFamily: fonts.body },
    age: { fontFamily: fonts.pixel, fontSize: 7, color: colors.textDim, letterSpacing: 0.8, marginTop: 10 },
    projLine: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 4 },
    flag: { fontFamily: fonts.pixel, fontSize: 8, letterSpacing: 0.8, marginTop: 10 },
    warnT: { fontFamily: fonts.pixel, fontSize: 9.5, color: colors.warn, letterSpacing: 1 },
    warnB: { fontSize: 12.5, color: colors.textMuted, marginTop: 7, lineHeight: 19, fontFamily: fonts.body },
  })
);
