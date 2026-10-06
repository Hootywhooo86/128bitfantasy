import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, CardHead, Chips, Empty, Field, Label, MenuRow, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import {
  autoDraft,
  bestFor,
  closeLot,
  draftOpts,
  draftPlayer,
  leagueBundle,
  leaveLeague,
  newSeason,
  nominate,
  placeBid,
  startDraft,
  watchLeague,
  type LeagueBundle,
} from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { auctionValues, draftRounds, draftState, maxBid, nextNominator, openSlots, pickLabel, rankPool } from '@/src/leagues/draft';
import { SPORT_NAMES } from '@/src/leagues/scoring';
import { nextSeason, settingsSummary } from '@/src/leagues/settings';
import { champion, leagueTable } from '@/src/leagues/standings';
import { FORMAT_LABELS, type PoolPlayer } from '@/src/leagues/types';
import { defaultHostedProject } from '@/src/providers/hosted-default';
import { syncLeagues } from '@/src/sports/hub';

const ACTIVITY: Record<string, string> = {
  add: 'ADD',
  drop: 'DROP',
  waiver: 'WAIVER CLAIM',
  'trade-in': 'TRADED FOR',
  'pick-in': 'GOT PICK',
  keeper: 'KEPT',
  commish: 'COMMISSIONER',
};

/** How often the board re-reads during a draft, in case live updates are off in Supabase. */
const DRAFT_POLL_MS = 5_000;

type Ranked = PoolPlayer & { value: number };

export default function HostedLeague() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      setB(await leagueBundle(id));
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

  // Live: picks and bids arrive by Supabase Realtime, with a quick poll behind it.
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

  async function run(what: string, fn: () => Promise<unknown>) {
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
  const divisionOf = new Map(teams.map((t) => [t.id, t.division]));
  const champ =
    league.status === 'season' || league.status === 'done'
      ? champion(league.sport, league.settings, teams.map((t) => t.id), b.matchups, b.weekScores, divisionOf)
      : null;
  const sportName = SPORT_NAMES[league.sport];
  const s = league.settings;
  const go = (path: '/hosted/[id]/lineup' | '/hosted/[id]/players' | '/hosted/[id]/trades' | '/hosted/[id]/settings' | '/hosted/[id]/commish' | '/hosted/[id]/keepers') =>
    router.push({ pathname: path, params: { id: league.id } });

  return (
    <Screen section={`${sportName} · 128bit Leagues`} back onRefresh={() => reload()} refreshing={false}>
      <Text style={st.title}>{league.name}</Text>
      <Text style={st.meta}>
        {`${sportName} ${league.season} · ${FORMAT_LABELS[s.format]} · ${teams.length}/${league.maxTeams} teams · ${b.myTeamId ? `You: ${teamName(b.myTeamId)}` : 'not in it'}`}
      </Text>
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
            {defaultHostedProject() ? null : (
              <Text style={st.small}>They also need the same Supabase Project URL and key — send those the first time.</Text>
            )}
          </Card>
          {league.previousId ? (
            <MenuRow
              icon="★"
              name="CHOOSE KEEPERS"
              sub={`Keep up to ${s.keepers} from last season · ${[...b.keepers.values()].filter((t) => t === b.myTeamId).length} chosen`}
              onPress={() => go('/hosted/[id]/keepers')}
            />
          ) : null}
          <MenuRow
            icon="⚙"
            name={isCommish ? 'LEAGUE SETTINGS · EDIT' : 'LEAGUE SETTINGS'}
            sub={`${FORMAT_LABELS[s.format]} · ${settingsSummary(league.sport, s)}`}
            onPress={() => go('/hosted/[id]/settings')}
          />
          {isCommish ? <MenuRow icon="♛" name="COMMISSIONER TOOLS" sub="Teams, divisions, remove a team, hand over the league" onPress={() => go('/hosted/[id]/commish')} /> : null}
          <MenuRow icon="⇄" name="TRADE PICKS" sub="Picks can be traded before the draft" onPress={() => go('/hosted/[id]/trades')} />
          <Label>{`TEAMS · ${teams.length}`}</Label>
          <Card>
            {teams.map((t) => (
              <Text key={t.id} style={st.row}>
                {`${t.name}${t.owner === league.commissioner ? '  (COMMISSIONER)' : ''}${t.id === b.myTeamId ? '  · YOU' : ''}${t.division != null && s.divisions[t.division] ? `  · ${s.divisions[t.division]}` : ''}`}
              </Text>
            ))}
          </Card>
          {isCommish ? (
            <Button
              label="START THE DRAFT"
              busy={busy === 'start'}
              disabled={teams.length < 2}
              onPress={() =>
                Alert.alert('Start the draft?', `The order is random.${league.previousId ? ' Keepers lock now.' : ''} Nobody else can join after this.`, [
                  { text: 'Not yet', style: 'cancel' },
                  { text: 'Start', onPress: () => run('start', () => startDraft(b, new Date().toISOString())) },
                ])
              }
            />
          ) : (
            <Note>Waiting for the commissioner to start the draft.</Note>
          )}
          {!league.previousId ? (
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
          ) : null}
        </>
      ) : null}

      {league.status === 'drafting' && s.draftType !== 'auction' ? (
        <DraftRoom b={b} ranked={ranked} pool={pool} now={now} busy={busy} run={run} teamName={teamName} />
      ) : null}
      {league.status === 'drafting' && s.draftType === 'auction' ? (
        <AuctionRoom b={b} ranked={ranked} pool={pool} now={now} busy={busy} run={run} teamName={teamName} />
      ) : null}
      {league.status === 'drafting' && isCommish ? (
        <MenuRow icon="♛" name="COMMISSIONER TOOLS" sub="Pick for the team on the clock, fix rosters" onPress={() => go('/hosted/[id]/commish')} />
      ) : null}

      {league.status === 'season' || league.status === 'done' ? (
        <>
          {champ ? (
            <Card style={{ borderColor: colors.accent }}>
              <CardHead title="CHAMPION" note={league.season} />
              <Text style={st.clock}>{`🏆 ${teamName(champ)}`}</Text>
            </Card>
          ) : null}
          {b.nextId ? (
            <MenuRow icon="▶" name="NEXT SEASON" sub="Keepers and the new draft" onPress={() => router.push({ pathname: '/hosted/[id]', params: { id: b.nextId! } })} />
          ) : null}
          <MenuRow
            icon="▶"
            name="MY TEAM · LIVE SCORING"
            sub="Matchup, roster points, standings, Coaches Corner"
            onPress={() => router.push({ pathname: '/league/[provider]/[id]', params: { provider: 'bit128', id: league.id } })}
          />
          {league.status === 'season' ? (
            <>
              <MenuRow icon="☰" name="SET LINEUP" sub="Starters count from the start of each game" onPress={() => go('/hosted/[id]/lineup')} />
              <MenuRow
                icon="+"
                name="FREE AGENTS & WAIVERS"
                sub={
                  s.waivers.type === 'faab'
                    ? `FAAB bids · $${myTeam?.faab ?? 0} left`
                    : s.waivers.type === 'rolling'
                      ? `Waiver priority #${myTeam?.waiverRank ?? '—'}`
                      : 'Add and drop, first come first served'
                }
                value={myClaims ? `${myClaims} claim${myClaims === 1 ? '' : 's'}` : undefined}
                onPress={() => go('/hosted/[id]/players')}
              />
              <MenuRow
                icon="⇄"
                name="TRADES"
                sub={offersToMe ? `${offersToMe} offer${offersToMe === 1 ? '' : 's'} waiting for you` : 'Players and picks · propose, accept, review'}
                value={openTrades ? `${openTrades} open` : undefined}
                onPress={() => go('/hosted/[id]/trades')}
              />
            </>
          ) : null}
          <MenuRow icon="⚙" name="LEAGUE SETTINGS" sub={`${FORMAT_LABELS[s.format]} · ${settingsSummary(league.sport, s)}`} onPress={() => go('/hosted/[id]/settings')} />
          {isCommish ? (
            <MenuRow icon="♛" name="COMMISSIONER TOOLS" sub="Move players, set lineups, teams, divisions" onPress={() => go('/hosted/[id]/commish')} />
          ) : null}
          {isCommish && !b.nextId ? (
            <Button
              label={`START ${nextSeason(league.season)} SEASON`}
              kind="ghost"
              busy={busy === 'next'}
              onPress={() =>
                Alert.alert(
                  `Start the ${nextSeason(league.season)} season?`,
                  `This season closes. Same teams and settings carry over${s.keepers ? `, and everyone picks up to ${s.keepers >= 99 ? 'their whole roster' : s.keepers} keeper${s.keepers === 1 ? '' : 's'}` : ''}.`,
                  [
                    { text: 'Not yet', style: 'cancel' },
                    {
                      text: 'Start',
                      onPress: () =>
                        run('next', async () => {
                          const nl = await newSeason(league.id, nextSeason(league.season));
                          await syncLeagues().catch(() => undefined);
                          router.push({ pathname: '/hosted/[id]', params: { id: nl } });
                        }),
                    },
                  ]
                )
              }
            />
          ) : null}
          <Standings b={b} teamName={teamName} />
          <Label>LEAGUE ACTIVITY</Label>
          <Card>
            {b.activity.slice(0, 12).map((a) => (
              <Text key={a.id} style={st.row}>
                {`${ACTIVITY[a.kind] ?? a.kind.toUpperCase()} · ${a.teamId ? teamName(a.teamId) : 'League'}${a.playerId ? ` · ${pool?.get(a.playerId)?.name ?? a.playerId}` : ''}${a.detail ? ` · ${a.kind === 'pick-in' ? pickLabel(a.detail, teamName) : a.detail}` : ''}`}
              </Text>
            ))}
            {b.activity.length === 0 ? <Text style={st.row}>Nothing yet.</Text> : null}
          </Card>
          <Label>DRAFT RESULTS</Label>
          <Card>
            {b.picks.slice(0, teams.length * 3).map((p) => (
              <Text key={p.pickNo} style={st.row}>
                {`${p.pickNo + 1}. ${pool?.get(p.playerId)?.name ?? p.playerId} — ${teamName(p.teamId)}${p.price != null ? ` · $${p.price}` : ''}${p.auto ? ' (auto)' : ''}`}
              </Text>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}


/** Standings in the league's own format, split by division when there are any. */
function Standings({ b, teamName }: { b: LeagueBundle; teamName: (t: string | null) => string }) {
  const s = b.league.settings;
  const table = leagueTable(b.league.sport, s, b.teams.map((t) => t.id), b.matchups, b.weekScores);
  if (!b.weekScores.length) return null;
  const division = new Map(b.teams.map((t) => [t.id, t.division]));
  const groups: { title: string; rows: typeof table }[] = s.divisions.length
    ? [
        ...s.divisions.map((d, i) => ({ title: d.toUpperCase(), rows: table.filter((r) => division.get(r.teamId) === i) })),
        { title: 'NO DIVISION', rows: table.filter((r) => division.get(r.teamId) == null || !s.divisions[division.get(r.teamId)!]) },
      ].filter((g) => g.rows.length)
    : [{ title: 'STANDINGS', rows: table }];
  const right = (r: (typeof table)[number]) =>
    s.format === 'roto'
      ? `${r.score ?? 0} roto pts`
      : s.format === 'points'
        ? `${r.pointsFor.toFixed(1)} pts`
        : `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''} · ${r.pointsFor.toFixed(1)}`;
  return (
    <>
      {groups.map((g) => (
        <React.Fragment key={g.title}>
          <Label>{g.title}</Label>
          <Card>
            {g.rows.map((r) => (
              <Text key={r.teamId} style={st.row}>{`${r.rank}. ${teamName(r.teamId)}${r.teamId === b.myTeamId ? ' (YOU)' : ''} · ${right(r)}`}</Text>
            ))}
          </Card>
        </React.Fragment>
      ))}
    </>
  );
}

type RoomProps = {
  b: LeagueBundle;
  ranked: Ranked[];
  pool: Map<string, PoolPlayer> | null;
  now: number;
  busy: string | null;
  run: (what: string, fn: () => Promise<unknown>) => Promise<void>;
  teamName: (t: string | null) => string;
};

function PlayerList({
  b,
  ranked,
  taken,
  action,
  extra,
}: {
  b: LeagueBundle;
  ranked: Ranked[];
  taken: Set<string>;
  action?: { label: string; busyId: string | null; onPress: (p: Ranked) => void };
  extra?: (p: Ranked) => string;
}) {
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const positions = ['ALL', ...new Set(ranked.flatMap((p) => p.position.split('/')))].slice(0, 12);
  const want = q.trim().toLowerCase();
  const list = ranked
    .filter((p) => !taken.has(p.id) && (pos === 'ALL' || p.position.split('/').includes(pos)) && (!want || p.name.toLowerCase().includes(want)))
    .slice(0, 60);
  return (
    <>
      <Chips items={positions.map((p) => ({ id: p, label: p }))} value={pos} onChange={setPos} />
      <Field label="SEARCH" value={q} onChangeText={setQ} placeholder="Player name" />
      <Card>
        {list.map((p) => (
          <View key={p.id} style={st.prow}>
            <Text style={st.ppos}>{p.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.pname} numberOfLines={1}>{p.name}</Text>
              <Text style={st.pmeta}>{`${p.team ?? 'FA'} · ${p.value.toFixed(1)} pts · ${p.gamesPlayed} GP${extra ? ` · ${extra(p)}` : ''}`}</Text>
            </View>
            {action ? (
              <Pressable style={st.draftBtn} onPress={() => action.onPress(p)} disabled={!!action.busyId}>
                <Text style={st.draftT}>{action.busyId === p.id ? '…' : action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {list.length === 0 ? <Text style={st.row}>{b ? 'Nobody matches.' : ''}</Text> : null}
      </Card>
    </>
  );
}

function DraftRoom({ b, ranked, pool, now, busy, run, teamName }: RoomProps) {
  const s = b.league.settings;
  const st0 = draftState(b.league.draftOrder, s, b.picks, draftOpts(b));
  const myTurn = !!st0.onClock && st0.onClock === b.myTeamId;
  const deadline = (b.league.lastPickAt ? Date.parse(b.league.lastPickAt) : now) + s.pickSeconds * 1000;
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  const overdue = left === 0;
  const mine = b.roster.filter((r) => r.teamId === b.myTeamId);
  const needs = openSlots(s.slots, mine.map((r) => r.position), b.league.sport);
  const taken = new Set([...st0.taken, ...b.roster.map((r) => r.playerId)]);

  return (
    <>
      <Card style={myTurn ? { borderColor: colors.accent } : undefined}>
        <CardHead title={myTurn ? 'YOU ARE ON THE CLOCK' : 'ON THE CLOCK'} note={`Round ${st0.round} of ${st0.rounds} · pick ${(st0.pickNo ?? 0) + 1}`} />
        <Text style={st.clock}>{`${teamName(st0.onClock)}${st0.via ? `  (via ${teamName(st0.via)})` : ''}`}</Text>
        <Text style={[st.timer, overdue && { color: colors.loss }]}>{overdue ? 'TIME UP' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</Text>
        {overdue && !myTurn ? (
          <Button
            label={`AUTO-PICK FOR ${teamName(st0.onClock).toUpperCase()}`}
            kind="ghost"
            busy={busy === 'auto'}
            onPress={() => run('auto', () => autoDraft(b, [...(pool?.values() ?? [])]))}
          />
        ) : null}
        {myTurn ? <Button label="AUTO-PICK FOR ME" kind="ghost" busy={busy === 'auto'} onPress={() => run('auto', () => autoDraft(b, [...(pool?.values() ?? [])]))} /> : null}
      </Card>
      <Text style={st.small}>{needs.length ? `You still need: ${needs.join(' · ')}` : 'Starting lineup full — drafting bench now.'}</Text>
      <Label>BEST AVAILABLE · LAST SEASON POINTS</Label>
      {!pool ? <Note>Loading players…</Note> : null}
      <PlayerList
        b={b}
        ranked={ranked}
        taken={taken}
        action={myTurn ? { label: 'DRAFT', busyId: busy?.startsWith('p') ? busy.slice(1) : null, onPress: (p) => run(`p${p.id}`, () => draftPlayer(b, p)) } : undefined}
      />
      <Label>LATEST PICKS</Label>
      <Card>
        {[...b.picks].reverse().slice(0, 12).map((p) => (
          <Text key={p.pickNo} style={st.row}>
            {`${p.pickNo + 1}. ${pool?.get(p.playerId)?.name ?? p.playerId} (${pool?.get(p.playerId)?.position ?? ''}) — ${teamName(p.teamId)}${p.auto ? ' · auto' : ''}`}
          </Text>
        ))}
        {b.picks.length === 0 ? <Text style={st.row}>No picks yet.</Text> : null}
      </Card>
    </>
  );
}

function AuctionRoom({ b, ranked, pool, now, busy, run, teamName }: RoomProps) {
  const s = b.league.settings;
  const lot = b.league.lot;
  const rounds = draftRounds(s, !b.league.previousId);
  const bought = (t: string) => b.picks.filter((p) => p.teamId === t).length;
  const needs = (t: string) => rounds - bought(t);
  const me = b.teams.find((t) => t.id === b.myTeamId);
  const myMax = me ? maxBid(me.budget, needs(me.id)) : 0;
  const nominator = lot ? null : nextNominator(b.league.draftOrder, b.league.nominateIdx, needs);
  const myNominate = !lot && nominator === b.myTeamId;
  const endsAt = lot ? Date.parse(lot.ends_at) : 0;
  const lotLeft = lot ? Math.max(0, Math.round((endsAt - now) / 1000)) : 0;
  const nomDeadline = (b.league.lastPickAt ? Date.parse(b.league.lastPickAt) : now) + s.pickSeconds * 1000;
  const nomLeft = Math.max(0, Math.round((nomDeadline - now) / 1000));
  const [bid, setBid] = useState('');
  const values = useMemo(() => auctionValues(ranked, b.teams.length, rounds, s.auctionBudget), [ranked, b.teams.length, rounds, s.auctionBudget]);
  const taken = new Set([...b.picks.map((p) => p.playerId), ...b.roster.map((r) => r.playerId)]);

  // Anyone's phone closes a lot whose clock has run out.
  const expired = !!lot && lotLeft === 0;
  useEffect(() => {
    if (expired) run('close', () => closeLot(b.league.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, b.league.id]);

  const lotPlayer = lot ? pool?.get(lot.player) : null;
  const next = lot ? Number(lot.bid) + 1 : 1;

  return (
    <>
      {lot ? (
        <Card style={{ borderColor: colors.accent }}>
          <CardHead title="UP FOR BIDS" note={`nominated by ${teamName(lot.nominator)}`} />
          <Text style={st.clock}>{lotPlayer ? `${lotPlayer.name} · ${lotPlayer.position} · ${lotPlayer.team ?? ''}` : lot.player}</Text>
          <Text style={st.bigBid}>{`$${lot.bid}`}</Text>
          <Text style={st.small}>{`High bid: ${teamName(lot.team)}${lot.team === b.myTeamId ? ' (YOU)' : ''}`}</Text>
          <Text style={[st.timer, lotLeft <= 5 && { color: colors.loss }]}>{lotLeft ? `0:${String(lotLeft).padStart(2, '0')}` : 'SOLD…'}</Text>
          {me && needs(me.id) > 0 && lot.team !== b.myTeamId && lotLeft > 0 ? (
            <View style={st.bidRow}>
              {[next, next + 4, next + 9].filter((x) => x <= myMax).map((x) => (
                <Pressable key={x} style={st.draftBtn} onPress={() => run('bid', () => placeBid(b.league.id, x))} disabled={!!busy}>
                  <Text style={st.draftT}>{`$${x}`}</Text>
                </Pressable>
              ))}
              <TextInput style={st.box} keyboardType="number-pad" placeholder={`$${next}`} placeholderTextColor={colors.textDim} value={bid} onChangeText={setBid} />
              <Pressable style={st.draftBtn} onPress={() => run('bid', () => placeBid(b.league.id, Math.round(Number(bid) || 0)))} disabled={!!busy}>
                <Text style={st.draftT}>BID</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>
      ) : (
        <Card style={myNominate ? { borderColor: colors.accent } : undefined}>
          <CardHead title={myNominate ? 'YOUR TURN TO NOMINATE' : 'NOMINATING'} note={`${b.picks.length} of ${b.teams.length * rounds} bought`} />
          <Text style={st.clock}>{teamName(nominator)}</Text>
          <Text style={[st.timer, nomLeft === 0 && { color: colors.loss }]}>{nomLeft ? `${Math.floor(nomLeft / 60)}:${String(nomLeft % 60).padStart(2, '0')}` : 'TIME UP'}</Text>
          {nomLeft === 0 && !myNominate && nominator ? (
            <Button
              label={`NOMINATE FOR ${teamName(nominator).toUpperCase()}`}
              kind="ghost"
              busy={busy === 'autonom'}
              onPress={() =>
                run('autonom', async () => {
                  const p = bestFor(b, [...(pool?.values() ?? [])], nominator, bought(nominator) + 1, rounds);
                  if (p) await nominate(b.league.id, p, 1);
                })
              }
            />
          ) : null}
        </Card>
      )}

      <Label>BUDGETS</Label>
      <Card>
        {b.teams.map((t) => (
          <Text key={t.id} style={st.row}>
            {`${t.name}${t.id === b.myTeamId ? ' (YOU)' : ''} · $${t.budget} left · ${needs(t.id)} to buy · max bid $${maxBid(t.budget, needs(t.id))}`}
          </Text>
        ))}
      </Card>

      <Label>{myNominate ? 'PUT SOMEONE UP · OPENS AT $1' : 'PLAYERS · SUGGESTED VALUE'}</Label>
      {!pool ? <Note>Loading players…</Note> : null}
      <PlayerList
        b={b}
        ranked={ranked}
        taken={taken}
        extra={(p) => `worth ~$${values.get(p.id) ?? 1}`}
        action={
          myNominate
            ? { label: 'NOMINATE', busyId: busy?.startsWith('n') ? busy.slice(1) : null, onPress: (p) => run(`n${p.id}`, () => nominate(b.league.id, p, 1)) }
            : undefined
        }
      />
      <Label>SOLD</Label>
      <Card>
        {[...b.picks].reverse().slice(0, 15).map((p) => (
          <Text key={p.pickNo} style={st.row}>{`${pool?.get(p.playerId)?.name ?? p.playerId} — ${teamName(p.teamId)} · $${p.price ?? '?'}`}</Text>
        ))}
        {b.picks.length === 0 ? <Text style={st.row}>Nobody yet.</Text> : null}
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
    clock: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 6 },
    bigBid: { fontFamily: fonts.pixel, fontSize: 30, color: colors.accent, marginTop: 8 },
    timer: { fontFamily: fonts.pixel, fontSize: 18, color: colors.accent, marginTop: 6, letterSpacing: 2 },
    prow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    ppos: { width: 44, fontFamily: fonts.pixel, fontSize: 7.5, color: colors.accent },
    pname: { fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    pmeta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    draftBtn: { backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    draftT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
    bidRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
    box: {
      width: 70,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      color: colors.text,
      fontFamily: fonts.body,
      fontSize: 14,
      backgroundColor: colors.surfaceAlt,
    },
  })
);
