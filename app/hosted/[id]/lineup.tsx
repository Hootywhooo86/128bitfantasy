import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardHead, Empty, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import { leagueBundle, setSlot, type LeagueBundle } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { slotTakes } from '@/src/leagues/draft';
import type { PoolPlayer } from '@/src/leagues/types';
import { fetchSnapshot, cachedLeagues } from '@/src/sports/hub';

/**
 * Your lineup. Tap a player, tap where he goes. A move into a full slot
 * swaps with whoever is there (or benches them if they can't swap back).
 * Points count from each game's start, so moving someone in after his game
 * began does nothing for that game.
 */
export default function Lineup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!b) {
    return (
      <Screen section="Lineup" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading your roster…" />}
      </Screen>
    );
  }

  const s = b.league.settings;
  const mine = b.roster.filter((r) => r.teamId === b.myTeamId);
  const name = (pid: string) => pool?.get(pid)?.name ?? pid;
  const slotOrder = [...Object.keys(s.slots), 'BN', 'IR'];
  const inSlot = (slot: string) => mine.filter((r) => r.slot === slot);
  const sel = mine.find((r) => r.playerId === picked) ?? null;

  async function move(slot: string) {
    if (!sel || !b) return;
    setBusy(true);
    setError(null);
    try {
      const cap = slot === 'BN' || slot === 'IR' ? Infinity : s.slots[slot] ?? 0;
      const there = inSlot(slot).filter((r) => r.playerId !== sel.playerId);
      if (there.length >= cap) {
        // Swap: the one already there takes the picked player's old slot if he fits it.
        const out = there[0];
        await setSlot(b.league.id, out.playerId, slotTakes(sel.slot, out.position) ? sel.slot : 'BN');
      }
      await setSlot(b.league.id, sel.playerId, slot);
      setB(await leagueBundle(b.league.id));
      setPicked(null);
      // Refresh the team screen's copy so it shows the new lineup.
      const lg = (await cachedLeagues()).find((l) => l.provider === 'bit128' && l.id === b.league.id);
      if (lg) fetchSnapshot(lg).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen section="Set Lineup" back>
      <Note>Tap a player, then tap where he goes. A game counts if he was in a starting spot when it began.</Note>
      {error ? <Note tone="error">{error}</Note> : null}
      {slotOrder.map((slot) => {
        const here = inSlot(slot);
        const cap = slot === 'BN' || slot === 'IR' ? null : s.slots[slot];
        if (!here.length && cap == null && slot === 'IR') return null;
        const canTake = !!sel && sel.slot !== slot && (slot === 'BN' || slot === 'IR' || slotTakes(slot, sel.position));
        return (
          <Card key={slot} style={canTake ? { borderColor: colors.accent } : undefined}>
            <CardHead title={slot === 'BN' ? 'BENCH' : slot} note={cap != null ? `${here.length}/${cap}` : `${here.length}`} />
            {here.map((r) => (
              <Pressable key={r.playerId} style={[st.row, picked === r.playerId && st.rowOn]} onPress={() => setPicked(picked === r.playerId ? null : r.playerId)}>
                <Text style={st.pos}>{r.position}</Text>
                <Text style={st.name} numberOfLines={1}>{name(r.playerId)}</Text>
                <Text style={st.team}>{pool?.get(r.playerId)?.team ?? ''}</Text>
              </Pressable>
            ))}
            {cap != null && here.length < cap ? <Text style={st.empty}>{`${cap - here.length} empty`}</Text> : null}
            {canTake ? (
              <Pressable style={st.moveBtn} onPress={() => move(slot)} disabled={busy}>
                <Text style={st.moveT}>{busy ? '…' : `MOVE ${name(sel!.playerId).toUpperCase()} HERE`}</Text>
              </Pressable>
            ) : null}
          </Card>
        );
      })}
      <View style={{ height: 24 }} />
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, gap: 10, borderRadius: 8 },
    rowOn: { backgroundColor: colors.surfaceAlt },
    pos: { width: 34, fontFamily: fonts.pixel, fontSize: 8, color: colors.accent },
    name: { flex: 1, fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    team: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body },
    empty: { fontSize: 12.5, color: colors.warn, fontFamily: fonts.body, paddingVertical: 6 },
    moveBtn: { marginTop: 8, backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    moveT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
  })
);
