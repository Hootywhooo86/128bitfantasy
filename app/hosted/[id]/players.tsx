import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardHead, Chips, Empty, Field, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import { addDrop, leagueBundle, type LeagueBundle } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { rankPool, rosterSize } from '@/src/leagues/draft';
import type { PoolPlayer } from '@/src/leagues/types';

/** Free agents: everyone nobody has, best last season first. Full roster → pick who to drop. */
export default function FreeAgents() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<PoolPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    leagueBundle(id).then(
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
  const owned = new Set(b.roster.map((r) => r.playerId));
  const mine = b.roster.filter((r) => r.teamId === b.myTeamId);
  const full = mine.length >= rosterSize(s);
  const positions = ['ALL', ...Object.keys(s.slots).filter((k) => !['UTIL', 'FLEX', 'SUPERFLEX'].includes(k))];
  const want = q.trim().toLowerCase();
  const list = ranked
    .filter((p) => !owned.has(p.id) && (pos === 'ALL' || p.position === pos) && (!want || p.name.toLowerCase().includes(want)))
    .slice(0, 50);

  async function go(add: PoolPlayer, drop: string | null) {
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      await addDrop(b.league.id, add, drop);
      setMsg(`${add.name} added to your bench${drop ? `, ${pool?.get(drop)?.name ?? drop} dropped` : ''}. Set your lineup to start him.`);
      setAdding(null);
      setB(await leagueBundle(b.league.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen section="Free Agents" back>
      {msg ? <Note>{msg}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      {b.league.status !== 'season' ? <Note>Pickups open once the draft is done.</Note> : null}

      {adding ? (
        <Card style={{ borderColor: colors.accent }}>
          <CardHead title={`ADD ${adding.name.toUpperCase()}`} note={full ? 'roster full — pick who goes' : 'room on your bench'} />
          {full ? (
            mine.map((r) => (
              <Pressable key={r.playerId} style={st.row} onPress={() => go(adding, r.playerId)} disabled={busy}>
                <Text style={st.pos}>{r.position}</Text>
                <Text style={st.name}>{`Drop ${pool?.get(r.playerId)?.name ?? r.playerId}`}</Text>
              </Pressable>
            ))
          ) : (
            <Pressable style={st.addBtn} onPress={() => go(adding, null)} disabled={busy}>
              <Text style={st.addT}>{busy ? '…' : 'CONFIRM ADD'}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setAdding(null)}>
            <Text style={st.cancel}>Cancel</Text>
          </Pressable>
        </Card>
      ) : null}

      <Chips items={positions.map((p) => ({ id: p, label: p }))} value={pos} onChange={setPos} />
      <Field label="SEARCH" value={q} onChangeText={setQ} placeholder="Player name" />
      <Card>
        {list.map((p) => (
          <View key={p.id} style={st.row}>
            <Text style={st.pos}>{p.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.name} numberOfLines={1}>{p.name}</Text>
              <Text style={st.meta}>{`${p.team ?? 'FA'} · ${p.value.toFixed(1)} pts last season`}</Text>
            </View>
            {b.league.status === 'season' ? (
              <Pressable style={st.addBtn} onPress={() => setAdding(p)}>
                <Text style={st.addT}>ADD</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {!pool ? <Text style={st.meta}>Loading players…</Text> : null}
      </Card>
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    pos: { width: 34, fontFamily: fonts.pixel, fontSize: 8, color: colors.accent },
    name: { fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    meta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    addBtn: { backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', marginTop: 4 },
    addT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
    cancel: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, textAlign: 'center', marginTop: 12 },
  })
);
