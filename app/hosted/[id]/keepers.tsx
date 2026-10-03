import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Button, Card, CardHead, Empty, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import { leagueBundle, previousRoster, setKeepers, type LeagueBundle } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { fantasyPoints } from '@/src/leagues/scoring';
import type { PoolPlayer } from '@/src/leagues/types';

/** Pick who you keep from last season's final roster. Locks when the draft starts. */
export default function Keepers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [mine, setMine] = useState<{ playerId: string; position: string }[] | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    leagueBundle(id).then(
      async (nb) => {
        setB(nb);
        setPicked([...nb.keepers].filter(([, t]) => t === nb.myTeamId).map(([p]) => p));
        const me = nb.teams.find((t) => t.id === nb.myTeamId);
        if (nb.league.previousId && me?.previousTeam) {
          const prev = await previousRoster(nb.league.previousId);
          setMine(prev.filter((r) => r.teamId === me.previousTeam));
        } else {
          setMine([]);
        }
        setPool(await poolMap(nb.league.sport, nb.league.season));
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  }, [id]);

  const sorted = useMemo(() => {
    if (!b || !mine) return [];
    const val = (pid: string) => fantasyPoints(pool?.get(pid)?.seasonLine ?? {}, b.league.settings.scoring);
    return [...mine].sort((x, y) => val(y.playerId) - val(x.playerId));
  }, [b, mine, pool]);

  if (!b || !mine) {
    return (
      <Screen section="Keepers" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading last season…" />}
      </Screen>
    );
  }

  const limit = b.league.settings.keepers;
  const locked = b.league.status !== 'setup';
  const toggle = (p: string) =>
    setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : cur.length < limit ? [...cur, p] : cur));

  return (
    <Screen section="Keepers" back>
      <Note>
        {locked
          ? 'Keepers locked when the draft started.'
          : `Keep up to ${limit} from your final roster last season. Kept players join your team before the draft; the draft is shorter to make room.`}
      </Note>
      {msg ? <Note>{msg}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      <Card>
        <CardHead title="LAST SEASON'S ROSTER" note={`${picked.length} of ${limit} kept`} />
        {sorted.map((r) => {
          const on = picked.includes(r.playerId);
          const p = pool?.get(r.playerId);
          return (
            <Pressable key={r.playerId} disabled={locked} style={[st.row, on && st.on]} onPress={() => toggle(r.playerId)}>
              <Text style={[st.box, on && { color: colors.accent }]}>{on ? '★' : '☆'}</Text>
              <Text style={st.pos}>{r.position}</Text>
              <Text style={st.name} numberOfLines={1}>{p?.name ?? r.playerId}</Text>
              <Text style={st.meta}>{p?.team ?? ''}</Text>
            </Pressable>
          );
        })}
        {sorted.length === 0 ? <Text style={st.meta}>No players on your team last season.</Text> : null}
      </Card>
      {!locked ? (
        <>
          {limit >= sorted.length && sorted.length ? (
            <Button label="KEEP EVERYONE" kind="ghost" onPress={() => setPicked(sorted.map((r) => r.playerId))} />
          ) : null}
          <Button
            label="SAVE KEEPERS"
            busy={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await setKeepers(b.league.id, picked);
                setMsg(`Saved ${picked.length} keeper${picked.length === 1 ? '' : 's'}.`);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, gap: 10, borderRadius: 8 },
    on: { backgroundColor: colors.surfaceAlt },
    box: { fontSize: 16, color: colors.textDim, width: 18 },
    pos: { width: 44, fontFamily: fonts.pixel, fontSize: 7.5, color: colors.accent },
    name: { flex: 1, fontSize: 14.5, fontFamily: fonts.bodyMedium, color: colors.text },
    meta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body },
  })
);
