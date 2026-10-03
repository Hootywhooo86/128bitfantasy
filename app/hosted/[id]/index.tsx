import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Button, Card, CardHead, Chips, Empty, Field, Label, MenuRow, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import { autoDraft, draftPlayer, leagueBundle, leaveLeague, startDraft, watchLeague, type LeagueBundle } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { draftState, openSlots, rankPool, rosterSize } from '@/src/leagues/draft';
import type { PoolPlayer } from '@/src/leagues/types';
import { settingsSummary } from '@/src/leagues/settings';
import { champion } from '@/src/leagues/standings';
import { FORMAT_LABELS } from '@/src/leagues/types';
import { syncLeagues } from '@/src/sports/hub';

const ACTIVITY: Record<string, string> = { add: 'ADD', drop: 'DROP', waiver: 'WAIVER CLAIM', 'trade-in': 'TRADED FOR', commish: 'COMMISSIONER' };

/** How often the board re-reads during a draft, in case live updates are off in Supabase. */
const DRAFT_POLL_MS = 5_000;

export default function HostedLeague() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');

  const reload = useCallback(async () => {
    try {
      const nb = await leagueBundle(id);
      setB(nb);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    leagueBundle(id).then(setB, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // The player list: a day-cached download, read once per league.
  const sport = b?.league.sport;
  const season = b?.league.season;
  useEffect(() => {
    if (!sport || !season) return;
    let live = true;
    poolMap(sport, season).then(
      (m) => live && setPool(m),
      (e) => live && setError(`Couldn't load the player list: ${e instanceof Error ? e.message : String(e)}`)
    );
    return () => {
      live = false;
    };
  }, [sport, season]);

  // Live: new picks arrive by Supabase Realtime, with a slow poll behind it.
  const drafting = b?.league.status === 'drafting';
  useEffect(() => {
    if (!drafting) return;
    let stop: (() => void) | null = null;
    watchLeague(id, () => {
      reload();
    }).then((s) => (stop = s), () => undefined);
    const poll = setInterval(() => reload(), DRAFT_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop?.();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [drafting, id, reload]);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const ranked = useMemo(() => (b && pool ? rankPool([...pool.values()], b.league.settings.scoring) : []), [b, pool]);

  if (!b) {
    return (
      <Screen section="128bit Leagues" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }

  const { league, teams } = b;
  const teamName = (t: string | null) => teams.find((x) => x.id === t)?.name ?? '—';
  const isCommish = b.me === league.commissioner;
  const myTeam = teams.find((t) => t.id === b.myTeamId);
  const myClaims = b.myClaims.filter((c) => c.status === 'pending').length;
  const openTrades = b.trades.filter((t) => t.status === 'proposed' || t.status === 'accepted').length;
  const offersToMe = b.trades.filter((t) => t.status === 'proposed' && t.toTeam === b.myTeamId).length;
  const champ =
    league.status === 'season' || league.status === 'done'
      ? champion(league.sport, league.settings, teams.map((t) => t.id), b.matchups, b.weekScores)
      : null;
  const sportName = league.sport === 'nhl' ? 'Hockey' : 'Football';

  return (
    <Screen section={`${sportName} · 128bit Leagues`} back onRefresh={() => reload()} refreshing={false}>
      <Text style={st.title}>{league.name}</Text>
      <Text style={st.meta}>{`${sportName} · ${FORMAT_LABELS[league.settings.format]} · ${teams.length}/${league.maxTeams} teams · ${b.myTeamId ? `You: ${teamName(b.myTeamId)}` : 'not in it'}`}</Text>
      {error ? <Note tone="error">{error}</Note> : null}

      {league.status === 'setup' ? (
        <>
          <Card>
            <CardHead title="INVITE CODE" note="friends type this in JOIN" />
            <Text style={st.code}>{league.inviteCode}</Text>
            <Button
              label="SHARE INVITE"
              kind="ghost"
              onPress={() =>
                Share.share({
                  message: `Join my ${sportName.toLowerCase()} league "${league.name}" on 128BIT FANTASY: Settings → 128BIT LEAGUES → JOIN, code ${league.inviteCode}.`,
                }).catch(() => undefined)
              }
            />
            <Text style={st.small}>They also need the same Supabase Project URL and key — send those the first time.</Text>
          </Card>
          <MenuRow
            icon="⚙"
            name={isCommish ? 'LEAGUE SETTINGS · EDIT' : 'LEAGUE SETTINGS'}
            sub={`${FORMAT_LABELS[league.settings.format]} · ${settingsSummary(league.sport, league.settings)}`}
            onPress={() => router.push({ pathname: '/hosted/[id]/settings', params: { id: league.id } })}
          />
          <Label>{`TEAMS · ${teams.length}`}</Label>
          <Card>
            {teams.map((t) => (
              <Text key={t.id} style={st.row}>
                {`${t.name}${t.owner === league.commissioner ? '  (COMMISSIONER)' : ''}${t.id === b.myTeamId ? '  · YOU' : ''}`}
              </Text>
            ))}
          </Card>
          {isCommish ? (
            <Button
              label="START THE DRAFT"
              busy={busy === 'start'}
              disabled={teams.length < 2}
              onPress={() =>
                Alert.alert('Start the draft?', 'The order is random. Nobody else can join after this.', [
                  { text: 'Not yet', style: 'cancel' },
                  { text: 'Start', onPress: () => run('start', () => startDraft(b, new Date().toISOString())) },
                ])
              }
            />
          ) : (
            <Note>Waiting for the commissioner to start the draft.</Note>
          )}
          <Button
            label={isCommish ? 'DELETE LEAGUE' : 'LEAVE LEAGUE'}
            kind="danger"
            onPress={() =>
              run('leave', async () => {
                await leaveLeague(league.id);
                await syncLeagues().catch(() => undefined);
                router.back();
              })
            }
          />
        </>
      ) : null}

      {league.status === 'drafting' ? (
        <DraftRoom b={b} ranked={ranked} pool={pool} now={now} busy={busy} run={run} pos={pos} setPos={setPos} q={q} setQ={setQ} teamName={teamName} />
      ) : null}

      {league.status === 'season' || league.status === 'done' ? (
        <>
          <MenuRow
            icon="▶"
            name="MY TEAM · LIVE SCORING"
            sub="Matchup, roster points, standings, Coaches Corner"
            onPress={() => router.push({ pathname: '/league/[provider]/[id]', params: { provider: 'bit128', id: league.id } })}
          />
          <MenuRow icon="☰" name="SET LINEUP" sub="Starters count from puck drop / kickoff" onPress={() => router.push({ pathname: '/hosted/[id]/lineup', params: { id: league.id } })} />
          <MenuRow
            icon="+"
            name="FREE AGENTS & WAIVERS"
            sub={
              league.settings.waivers.type === 'faab'
                ? `FAAB bids · $${myTeam?.faab ?? 0} left`
                : league.settings.waivers.type === 'rolling'
                  ? `Waiver priority #${myTeam?.waiverRank ?? '—'}`
                  : 'Add and drop, first come first served'
            }
            value={myClaims ? `${myClaims} claim${myClaims === 1 ? '' : 's'}` : undefined}
            onPress={() => router.push({ pathname: '/hosted/[id]/players', params: { id: league.id } })}
          />
          <MenuRow
            icon="⇄"
            name="TRADES"
            sub={offersToMe ? `${offersToMe} offer${offersToMe === 1 ? '' : 's'} waiting for you` : 'Propose, accept, review'}
            value={openTrades ? `${openTrades} open` : undefined}
            onPress={() => router.push({ pathname: '/hosted/[id]/trades', params: { id: league.id } })}
          />
          <MenuRow
            icon="⚙"
            name="LEAGUE SETTINGS"
            sub={`${FORMAT_LABELS[league.settings.format]} · ${settingsSummary(league.sport, league.settings)}`}
            onPress={() => router.push({ pathname: '/hosted/[id]/settings', params: { id: league.id } })}
          />
          {champ ? (
            <Card style={{ borderColor: colors.accent }}>
              <CardHead title="CHAMPION" note={league.season} />
              <Text style={st.clock}>{`🏆 ${teamName(champ)}`}</Text>
            </Card>
          ) : null}
          <Label>LEAGUE ACTIVITY</Label>
          <Card>
            {b.activity.slice(0, 12).map((a) => (
              <Text key={a.id} style={st.row}>
                {`${ACTIVITY[a.kind] ?? a.kind.toUpperCase()} · ${a.teamId ? teamName(a.teamId) : 'League'}${a.playerId ? ` · ${pool?.get(a.playerId)?.name ?? a.playerId}` : ''}${a.detail ? ` · ${a.detail}` : ''}`}
              </Text>
            ))}
            {b.activity.length === 0 ? <Text style={st.row}>Nothing yet.</Text> : null}
          </Card>
          <Label>DRAFT RESULTS</Label>
          <Card>
            {b.picks.slice(0, teams.length * 3).map((p) => (
              <Text key={p.pickNo} style={st.row}>{`${p.pickNo + 1}. ${pool?.get(p.playerId)?.name ?? p.playerId} — ${teamName(p.teamId)}${p.auto ? ' (auto)' : ''}`}</Text>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function DraftRoom({
  b,
  ranked,
  pool,
  now,
  busy,
  run,
  pos,
  setPos,
  q,
  setQ,
  teamName,
}: {
  b: LeagueBundle;
  ranked: (PoolPlayer & { value: number })[];
  pool: Map<string, PoolPlayer> | null;
  now: number;
  busy: string | null;
  run: (what: string, fn: () => Promise<void>) => Promise<void>;
  pos: string;
  setPos: (p: string) => void;
  q: string;
  setQ: (s: string) => void;
  teamName: (t: string | null) => string;
}) {
  const s = b.league.settings;
  const st0 = draftState(b.league.draftOrder, s, b.picks);
  const myTurn = !!st0.onClock && st0.onClock === b.myTeamId;
  const deadline = (b.league.lastPickAt ? Date.parse(b.league.lastPickAt) : now) + s.pickSeconds * 1000;
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  const overdue = left === 0;

  const mine = b.roster.filter((r) => r.teamId === b.myTeamId);
  const needs = openSlots(s.slots, mine.map((r) => r.position));
  const positions = ['ALL', ...Object.keys(s.slots).filter((k) => !['UTIL', 'FLEX', 'SUPERFLEX'].includes(k))];
  const want = q.trim().toLowerCase();
  const list = ranked
    .filter((p) => !st0.taken.has(p.id) && (pos === 'ALL' || p.position === pos) && (!want || p.name.toLowerCase().includes(want)))
    .slice(0, 60);

  return (
    <>
      <Card style={myTurn ? { borderColor: colors.accent } : undefined}>
        <CardHead title={myTurn ? 'YOU ARE ON THE CLOCK' : 'ON THE CLOCK'} note={`Round ${st0.round} · pick ${(st0.pickNo ?? 0) + 1} of ${b.teams.length * rosterSize(s)}`} />
        <Text style={st.clock}>{teamName(st0.onClock)}</Text>
        <Text style={[st.timer, overdue && { color: colors.loss }]}>{overdue ? 'TIME UP' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</Text>
        {overdue && !myTurn ? (
          <Button
            label={`AUTO-PICK FOR ${teamName(st0.onClock).toUpperCase()}`}
            kind="ghost"
            busy={busy === 'auto'}
            onPress={() => run('auto', async () => void (await autoDraft(b, [...(pool?.values() ?? [])])))}
          />
        ) : null}
        {myTurn ? (
          <Button label="AUTO-PICK FOR ME" kind="ghost" busy={busy === 'auto'} onPress={() => run('auto', async () => void (await autoDraft(b, [...(pool?.values() ?? [])])))} />
        ) : null}
      </Card>
      <Text style={st.small}>{needs.length ? `You still need: ${needs.join(' · ')}` : 'Starting lineup full — drafting bench now.'}</Text>

      <Label>BEST AVAILABLE · LAST SEASON POINTS</Label>
      <Chips items={positions.map((p) => ({ id: p, label: p }))} value={pos} onChange={setPos} />
      <Field label="SEARCH" value={q} onChangeText={setQ} placeholder="Player name" />
      {!pool ? <Note>Loading players…</Note> : null}
      <Card>
        {list.map((p) => (
          <View key={p.id} style={st.prow}>
            <Text style={st.ppos}>{p.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.pname} numberOfLines={1}>{p.name}</Text>
              <Text style={st.pmeta}>{`${p.team ?? 'FA'} · ${p.value.toFixed(1)} pts · ${p.gamesPlayed} GP`}</Text>
            </View>
            {myTurn ? (
              <Pressable style={st.draftBtn} onPress={() => run(`p${p.id}`, () => draftPlayer(b, p))} disabled={!!busy}>
                <Text style={st.draftT}>{busy === `p${p.id}` ? '…' : 'DRAFT'}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </Card>

      <Label>LATEST PICKS</Label>
      <Card>
        {[...b.picks].reverse().slice(0, 12).map((p) => (
          <Text key={p.pickNo} style={st.row}>{`${p.pickNo + 1}. ${pool?.get(p.playerId)?.name ?? p.playerId} (${pool?.get(p.playerId)?.position ?? ''}) — ${teamName(p.teamId)}${p.auto ? ' · auto' : ''}`}</Text>
        ))}
        {b.picks.length === 0 ? <Text style={st.row}>No picks yet.</Text> : null}
      </Card>
    </>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4 },
    meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
    code: { fontFamily: fonts.pixel, fontSize: 28, color: colors.accent, letterSpacing: 6, textAlign: 'center', marginVertical: 12 },
    small: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 8, lineHeight: 17 },
    row: { fontSize: 13.5, color: colors.text, fontFamily: fonts.body, paddingVertical: 5 },
    clock: { fontSize: 20, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 6 },
    timer: { fontFamily: fonts.pixel, fontSize: 18, color: colors.accent, marginTop: 6, letterSpacing: 2 },
    prow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    ppos: { width: 34, fontFamily: fonts.pixel, fontSize: 8, color: colors.accent },
    pname: { fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    pmeta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    draftBtn: { backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    draftT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
  })
);
