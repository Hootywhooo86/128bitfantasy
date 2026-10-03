import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, CardHead, Chips, Empty, Field, Label, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import { addDrop, cancelClaim, leagueBundle, placeClaim, processDue, type LeagueBundle } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { rankPool, rosterSize } from '@/src/leagues/draft';
import type { PoolPlayer } from '@/src/leagues/types';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Free agents and waivers. A free agent is added on the spot; a player on
 * waivers takes a claim (with a bid in FAAB leagues), settled when his
 * waiver period ends.
 */
export default function FreeAgents() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<PoolPlayer | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [bid, setBid] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const ranked = useMemo(() => (b && pool ? rankPool([...pool.values()], b.league.settings.scoring) : []), [b, pool]);

  if (!b) {
    return (
      <Screen section="Free Agents" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }

  const s = b.league.settings;
  const me = b.teams.find((t) => t.id === b.myTeamId);
  const owned = new Set(b.roster.map((r) => r.playerId));
  const mine = b.roster.filter((r) => r.teamId === b.myTeamId);
  const active = mine.filter((r) => r.slot !== 'IR');
  const full = active.length >= rosterSize(s);
  const positions = ['ALL', ...Object.keys(s.slots).filter((k) => !['UTIL', 'FLEX', 'SUPERFLEX', 'F'].includes(k))];
  const want = q.trim().toLowerCase();
  const list = ranked
    .filter((p) => !owned.has(p.id) && (pos === 'ALL' || p.position === pos) && (!want || p.name.toLowerCase().includes(want)))
    .slice(0, 50);
  const pname = (pid: string) => pool?.get(pid)?.name ?? pid;
  const claims = b.myClaims.filter((c) => c.status === 'pending');
  const settled = b.myClaims.filter((c) => c.status === 'won' || c.status === 'lost').slice(0, 5);
  const onWaivers = adding ? b.waivers.get(adding.id) : undefined;
  const faab = s.waivers.type === 'faab';

  async function go() {
    if (!b || !adding) return;
    setBusy(true);
    setError(null);
    try {
      if (full && !drop) throw new Error('Your roster is full — pick someone to drop.');
      if (onWaivers) {
        await placeClaim(b.league.id, adding, drop, faab ? Math.max(0, Math.round(Number(bid) || 0)) : 0);
        setMsg(`Claim in for ${adding.name}. It's settled ${when(onWaivers)}.`);
      } else {
        await addDrop(b.league.id, adding, drop);
        setMsg(`${adding.name} added to your bench${drop ? `, ${pname(drop)} dropped` : ''}. Set your lineup to start him.`);
      }
      setAdding(null);
      setDrop(null);
      setBid('0');
      setB(await leagueBundle(b.league.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen section="Free Agents" back>
      {me && s.waivers.type !== 'none' ? (
        <Text style={st.status}>
          {faab ? `FAAB LEFT $${me.faab} OF $${s.waivers.budget}` : `WAIVER PRIORITY #${me.waiverRank ?? '—'} OF ${b.teams.length}`}
          {s.maxAddsPerWeek ? `  ·  ${s.maxAddsPerWeek} ADDS / WEEK` : ''}
        </Text>
      ) : null}
      {msg ? <Note>{msg}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      {b.league.status !== 'season' ? <Note>Pickups open once the draft is done.</Note> : null}

      {claims.length ? (
        <>
          <Label>MY CLAIMS</Label>
          <Card>
            {claims.map((c) => (
              <View key={c.id} style={st.row}>
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>{`${pname(c.playerId)}${faab ? ` · $${c.bid}` : ''}`}</Text>
                  <Text style={st.meta}>{`${c.dropPlayer ? `Drop ${pname(c.dropPlayer)} · ` : ''}settles ${b.waivers.get(c.playerId) ? when(b.waivers.get(c.playerId)!) : 'soon'}`}</Text>
                </View>
                <Pressable
                  style={st.ghostBtn}
                  onPress={async () => {
                    await cancelClaim(c.id).catch((e) => setError(String(e?.message ?? e)));
                    setB(await leagueBundle(b.league.id));
                  }}
                >
                  <Text style={st.ghostT}>CANCEL</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {settled.length ? (
        <Card>
          <CardHead title="RECENT RESULTS" />
          {settled.map((c) => (
            <Text key={c.id} style={st.meta}>{`${c.status === 'won' ? 'WON' : 'LOST'} · ${pname(c.playerId)}${c.note && c.status === 'lost' ? ` — ${c.note}` : ''}`}</Text>
          ))}
        </Card>
      ) : null}

      {adding ? (
        <Card style={{ borderColor: colors.accent }}>
          <CardHead title={`${onWaivers ? 'CLAIM' : 'ADD'} ${adding.name.toUpperCase()}`} note={onWaivers ? `on waivers until ${when(onWaivers)}` : 'free agent'} />
          {onWaivers && faab ? (
            <View style={st.row}>
              <Text style={[st.name, { flex: 1 }]}>{`Blind bid (you have $${me?.faab ?? 0})`}</Text>
              <TextInput style={st.box} keyboardType="number-pad" value={bid} onChangeText={setBid} />
            </View>
          ) : null}
          <Text style={st.side}>{full ? 'ROSTER FULL — PICK WHO GOES' : 'DROP SOMEONE? (OPTIONAL)'}</Text>
          {active.map((r) => (
            <Pressable key={r.playerId} style={[st.row, drop === r.playerId && st.rowOn]} onPress={() => setDrop(drop === r.playerId ? null : r.playerId)}>
              <Text style={st.pos}>{r.position}</Text>
              <Text style={[st.name, { flex: 1 }]}>{pname(r.playerId)}</Text>
              <Text style={st.meta}>{drop === r.playerId ? 'DROP' : r.slot}</Text>
            </Pressable>
          ))}
          <Pressable style={st.addBtn} onPress={go} disabled={busy}>
            <Text style={st.addT}>{busy ? '…' : onWaivers ? 'PLACE CLAIM' : 'CONFIRM ADD'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setAdding(null);
              setDrop(null);
            }}
          >
            <Text style={st.cancel}>Cancel</Text>
          </Pressable>
        </Card>
      ) : null}

      <Chips items={positions.map((p) => ({ id: p, label: p }))} value={pos} onChange={setPos} />
      <Field label="SEARCH" value={q} onChangeText={setQ} placeholder="Player name" />
      <Card>
        {list.map((p) => {
          const w = b.waivers.get(p.id);
          return (
            <View key={p.id} style={st.row}>
              <Text style={st.pos}>{p.position}</Text>
              <View style={{ flex: 1 }}>
                <Text style={st.name} numberOfLines={1}>{p.name}</Text>
                <Text style={st.meta}>{`${p.team ?? 'FA'} · ${p.value.toFixed(1)} pts last season${w ? ` · WAIVERS → ${when(w)}` : ''}`}</Text>
              </View>
              {b.league.status === 'season' ? (
                <Pressable style={w ? st.ghostBtn : st.addBtnSm} onPress={() => setAdding(p)}>
                  <Text style={w ? st.ghostT : st.addT}>{w ? 'CLAIM' : 'ADD'}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {!pool ? <Text style={st.meta}>Loading players…</Text> : null}
      </Card>
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    status: { fontFamily: fonts.pixel, fontSize: 8, color: colors.accent, letterSpacing: 1, marginTop: 4, marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: 6 },
    rowOn: { backgroundColor: colors.surfaceAlt },
    pos: { width: 34, fontFamily: fonts.pixel, fontSize: 8, color: colors.accent },
    name: { fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    meta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    side: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1.2, marginTop: 12, marginBottom: 4 },
    addBtn: { backgroundColor: colors.accent, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 12 },
    addBtnSm: { backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    addT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
    ghostBtn: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    ghostT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.text, letterSpacing: 1 },
    cancel: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, textAlign: 'center', marginTop: 12 },
    box: {
      width: 72,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      color: colors.text,
      fontFamily: fonts.body,
      fontSize: 14,
      textAlign: 'right',
      backgroundColor: colors.surfaceAlt,
    },
  })
);
