import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, CardHead, Chips, Empty, Field, Label, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import {
  cancelTrade,
  leagueBundle,
  processDue,
  proposeTrade,
  respondTrade,
  reviewTrade,
  vetoVote,
  type LeagueBundle,
  type Trade,
} from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import type { PoolPlayer } from '@/src/leagues/types';

const STATUS: Record<Trade['status'], string> = {
  proposed: 'Waiting for an answer',
  accepted: 'Accepted · in review',
  completed: 'Done',
  rejected: 'Turned down',
  cancelled: 'Cancelled',
  vetoed: 'Vetoed',
  failed: 'Couldn\'t go through',
};

/** Offers in, offers out, trades in review, history — and a builder for a new one. */
export default function Trades() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [partner, setPartner] = useState<string | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    await processDue(id).catch(() => undefined);
    setB(await leagueBundle(id));
  }, [id]);

  useEffect(() => {
    processDue(id)
      .catch(() => undefined)
      .then(() => leagueBundle(id))
      .then(
        (nb) => {
          setB(nb);
          return poolMap(nb.league.sport, nb.league.season).then(setPool);
        },
        (e) => setError(e instanceof Error ? e.message : String(e))
      );
  }, [id]);

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

  if (!b) {
    return (
      <Screen section="Trades" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }

  const me = b.myTeamId;
  const s = b.league.settings;
  const commish = b.me === b.league.commissioner;
  const teamName = (t: string) => b.teams.find((x) => x.id === t)?.name ?? '—';
  const pname = (p: string) => {
    const x = pool?.get(p);
    return x ? `${x.name} (${x.position})` : p;
  };
  const rosterOf = (t: string) => b.roster.filter((r) => r.teamId === t);
  const open = b.trades.filter((t) => t.status === 'proposed' || t.status === 'accepted');
  const past = b.trades.filter((t) => !open.includes(t)).slice(0, 15);
  const pastDeadline = !!s.trades.deadline && new Date().toISOString().slice(0, 10) > s.trades.deadline;

  const toggle = (list: string[], set: (l: string[]) => void, p: string) => set(list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);

  return (
    <Screen section="Trades" back onRefresh={() => reload()} refreshing={false}>
      <Note>
        {`${s.trades.review === 'none' ? 'Accepted trades go through right away.' : s.trades.review === 'commissioner' ? `The commissioner has ${s.trades.reviewHours}h to approve or veto, then it goes through.` : `Other teams have ${s.trades.reviewHours}h to vote it down (${s.trades.vetoVotes} vote${s.trades.vetoVotes === 1 ? '' : 's'} vetoes).`}${s.trades.deadline ? ` Deadline: ${s.trades.deadline}.` : ''}`}
      </Note>
      {error ? <Note tone="error">{error}</Note> : null}

      <Label>{`OPEN · ${open.length}`}</Label>
      {open.length === 0 ? <Note>No open offers.</Note> : null}
      {open.map((t) => {
        const toMe = t.toTeam === me && t.status === 'proposed';
        const fromMe = t.fromTeam === me && t.status === 'proposed';
        const canVote = t.status === 'accepted' && s.trades.review === 'vote' && me && me !== t.fromTeam && me !== t.toTeam && !t.votes.includes(me);
        const canReview = t.status === 'accepted' && commish;
        return (
          <Card key={t.id} style={toMe ? { borderColor: colors.accent } : undefined}>
            <CardHead title={`${teamName(t.fromTeam)} → ${teamName(t.toTeam)}`} note={STATUS[t.status]} />
            <TradeSides t={t} pname={pname} teamName={teamName} />
            {t.note ? <Text style={st.note}>{`“${t.note}”`}</Text> : null}
            {t.status === 'accepted' && t.reviewUntil ? (
              <Text style={st.meta}>{`Goes through ${new Date(t.reviewUntil).toLocaleString()}${s.trades.review === 'vote' ? ` · ${t.votes.length}/${s.trades.vetoVotes} veto votes` : ''}`}</Text>
            ) : null}
            <View style={st.btns}>
              {toMe ? (
                <>
                  <Mini label="ACCEPT" busy={busy === `a${t.id}`} onPress={() => run(`a${t.id}`, () => respondTrade(t.id, true))} />
                  <Mini label="DECLINE" ghost busy={busy === `d${t.id}`} onPress={() => run(`d${t.id}`, () => respondTrade(t.id, false))} />
                  <Mini
                    label="ASK COACH"
                    ghost
                    onPress={() =>
                      router.push({
                        pathname: '/coach/[provider]/[id]/[team]',
                        params: {
                          provider: 'bit128',
                          id: b.league.id,
                          team: me!,
                          q: `Should I accept this trade? I give ${t.get.map(pname).join(', ') || 'nothing'} and get ${t.give.map(pname).join(', ') || 'nothing'}.`,
                        },
                      })
                    }
                  />
                </>
              ) : null}
              {fromMe ? <Mini label="CANCEL OFFER" ghost busy={busy === `c${t.id}`} onPress={() => run(`c${t.id}`, () => cancelTrade(t.id))} /> : null}
              {canReview ? (
                <>
                  <Mini label="APPROVE NOW" busy={busy === `r${t.id}`} onPress={() => run(`r${t.id}`, () => reviewTrade(t.id, true))} />
                  <Mini label="VETO" ghost busy={busy === `v${t.id}`} onPress={() => run(`v${t.id}`, () => reviewTrade(t.id, false))} />
                </>
              ) : null}
              {canVote ? <Mini label="VOTE TO VETO" ghost busy={busy === `x${t.id}`} onPress={() => run(`x${t.id}`, () => vetoVote(t.id))} /> : null}
            </View>
          </Card>
        );
      })}

      {me && b.league.status === 'season' && !pastDeadline ? (
        <>
          <Label>PROPOSE A TRADE</Label>
          <Card>
            <Chips
              items={b.teams.filter((t) => t.id !== me).map((t) => ({ id: t.id, label: t.name.toUpperCase() }))}
              value={partner ?? ''}
              onChange={(v) => {
                setPartner(v);
                setGet([]);
              }}
            />
            {partner ? (
              <>
                <Text style={st.side}>YOU GIVE</Text>
                {rosterOf(me).map((r) => (
                  <Pick key={r.playerId} on={give.includes(r.playerId)} label={pname(r.playerId)} onPress={() => toggle(give, setGive, r.playerId)} />
                ))}
                <Text style={st.side}>{`YOU GET FROM ${teamName(partner).toUpperCase()}`}</Text>
                {rosterOf(partner).map((r) => (
                  <Pick key={r.playerId} on={get.includes(r.playerId)} label={pname(r.playerId)} onPress={() => toggle(get, setGet, r.playerId)} />
                ))}
                <Field label="NOTE (OPTIONAL)" value={note} onChangeText={setNote} placeholder="Your pitch" />
                <Button
                  label={`SEND OFFER · ${give.length} FOR ${get.length}`}
                  busy={busy === 'send'}
                  disabled={!give.length && !get.length}
                  onPress={() =>
                    run('send', async () => {
                      await proposeTrade(b.league.id, partner, give, get, note);
                      setGive([]);
                      setGet([]);
                      setNote('');
                      setPartner(null);
                    })
                  }
                />
                <Button
                  label="CHECK IT WITH COACHES CORNER"
                  kind="ghost"
                  disabled={!give.length && !get.length}
                  onPress={() =>
                    router.push({
                      pathname: '/coach/[provider]/[id]/[team]',
                      params: {
                        provider: 'bit128',
                        id: b.league.id,
                        team: me,
                        q: `Grade this trade with ${teamName(partner)}: I give ${give.map(pname).join(', ') || 'nothing'} and get ${get.map(pname).join(', ') || 'nothing'}.`,
                      },
                    })
                  }
                />
              </>
            ) : (
              <Text style={st.meta}>Pick a team to trade with.</Text>
            )}
          </Card>
        </>
      ) : null}
      {pastDeadline ? <Note>The trade deadline has passed.</Note> : null}

      <Label>HISTORY</Label>
      {past.length === 0 ? <Note>No trades yet.</Note> : null}
      {past.map((t) => (
        <Card key={t.id}>
          <CardHead title={`${teamName(t.fromTeam)} ↔ ${teamName(t.toTeam)}`} note={STATUS[t.status]} />
          <TradeSides t={t} pname={pname} teamName={teamName} />
          {t.status === 'failed' && t.note ? <Text style={st.meta}>{t.note}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}

function TradeSides({ t, pname, teamName }: { t: Trade; pname: (p: string) => string; teamName: (t: string) => string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={st.line}>{`${teamName(t.fromTeam)} gives: ${t.give.map(pname).join(', ') || 'nothing'}`}</Text>
      <Text style={st.line}>{`${teamName(t.toTeam)} gives: ${t.get.map(pname).join(', ') || 'nothing'}`}</Text>
    </View>
  );
}

function Pick({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable style={[st.pick, on && st.pickOn]} onPress={onPress}>
      <Text style={[st.pickBox, on && { color: colors.accent }]}>{on ? '■' : '□'}</Text>
      <Text style={st.pickT} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Mini({ label, onPress, ghost, busy }: { label: string; onPress: () => void; ghost?: boolean; busy?: boolean }) {
  return (
    <Pressable style={[st.mini, ghost && st.miniGhost]} onPress={busy ? undefined : onPress}>
      <Text style={[st.miniT, ghost && { color: colors.text }]}>{busy ? '…' : label}</Text>
    </Pressable>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    line: { fontSize: 13.5, color: colors.text, fontFamily: fonts.body, lineHeight: 19 },
    note: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, fontStyle: 'italic', marginTop: 8 },
    meta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 8 },
    btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    mini: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
    miniGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
    miniT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
    side: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1.2, marginTop: 14, marginBottom: 4 },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8 },
    pickOn: { backgroundColor: colors.surfaceAlt },
    pickBox: { fontSize: 14, color: colors.textDim, width: 16 },
    pickT: { flex: 1, fontSize: 14, fontFamily: fonts.bodyMedium, color: colors.text },
  })
);
