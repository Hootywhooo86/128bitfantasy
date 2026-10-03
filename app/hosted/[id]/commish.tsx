import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, CardHead, Chips, Empty, Field, Label, Note, Screen } from '@/components/ui';
import { poolMap } from '@/lib/leagues/adapter';
import {
  commishMove,
  commishPick,
  commishRemoveTeam,
  commishTeam,
  commishTransfer,
  leagueBundle,
  type LeagueBundle,
  type TeamRow,
} from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { rankPool } from '@/src/leagues/draft';
import type { PoolPlayer } from '@/src/leagues/types';
import { syncLeagues } from '@/src/sports/hub';

/**
 * The commissioner's toolbox: fix teams, divisions and budgets, move or
 * release any player, set any team's lineup, pick for whoever is on the
 * clock, or hand the league to someone else.
 */
export default function Commish() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [pool, setPool] = useState<Map<string, PoolPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [player, setPlayer] = useState<PoolPlayer | null>(null);
  const [dest, setDest] = useState<string>('');

  const reload = useCallback(async () => setB(await leagueBundle(id)), [id]);

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

  async function run(what: string, done: string, fn: () => Promise<unknown>) {
    setBusy(what);
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!b) {
    return (
      <Screen section="Commissioner" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }
  if (b.me !== b.league.commissioner) {
    return (
      <Screen section="Commissioner" back>
        <Note>Only the commissioner can use these tools.</Note>
      </Screen>
    );
  }

  const s = b.league.settings;
  const teamName = (t: string | null) => b.teams.find((x) => x.id === t)?.name ?? 'Free agents';
  const owner = new Map(b.roster.map((r) => [r.playerId, r.teamId]));
  const want = q.trim().toLowerCase();
  const matches = want.length >= 2 ? ranked.filter((p) => p.name.toLowerCase().includes(want)).slice(0, 8) : [];

  return (
    <Screen section="Commissioner" back onRefresh={() => reload()} refreshing={false}>
      <Text style={st.title}>Commissioner tools</Text>
      <Text style={st.body}>Every change here is logged in league activity.</Text>
      {msg ? <Note>{msg}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}

      <Label>MOVE OR RELEASE ANY PLAYER</Label>
      <Card>
        <Field label="FIND A PLAYER" value={q} onChangeText={setQ} placeholder="Name" />
        {matches.map((p) => (
          <Pressable key={p.id} style={[st.prow, player?.id === p.id && st.on]} onPress={() => setPlayer(p)}>
            <Text style={st.ppos}>{p.position}</Text>
            <Text style={st.pname} numberOfLines={1}>{p.name}</Text>
            <Text style={st.meta}>{teamName(owner.get(p.id) ?? null)}</Text>
          </Pressable>
        ))}
        {player ? (
          <>
            <Text style={st.lbl}>{`MOVE ${player.name.toUpperCase()} TO`}</Text>
            <Chips
              items={[...b.teams.map((t) => ({ id: t.id, label: t.name.toUpperCase() })), { id: 'release', label: 'RELEASE' }]}
              value={dest}
              onChange={setDest}
            />
            <Button
              label="MOVE"
              busy={busy === 'move'}
              disabled={!dest}
              onPress={() =>
                run('move', `${player.name} → ${dest === 'release' ? 'free agents' : teamName(dest)}.`, () =>
                  commishMove(b.league.id, player.id, player.position, dest === 'release' ? null : dest, null)
                )
              }
            />
            <Text style={st.meta}>Skips waivers and add limits. Lineup and roster rules still apply.</Text>
          </>
        ) : null}
      </Card>

      {b.league.status === 'drafting' && s.draftType !== 'auction' ? (
        <>
          <Label>PICK FOR THE TEAM ON THE CLOCK</Label>
          <Card>
            <Text style={st.body}>Find a player above, then make the pick for whoever is up — any time, no waiting for the clock.</Text>
            <Button
              label={player ? `DRAFT ${player.name.toUpperCase()}` : 'FIND A PLAYER FIRST'}
              disabled={!player}
              busy={busy === 'pick'}
              onPress={() => player && run('pick', `${player.name} drafted.`, () => commishPick(b.league.id, player))}
            />
          </Card>
        </>
      ) : null}

      <Label>TEAMS</Label>
      {b.teams.map((t) => (
        <TeamEditor
          key={t.id}
          team={t}
          divisions={s.divisions}
          showWaivers={b.league.status !== 'setup' && s.waivers.type !== 'none'}
          faab={s.waivers.type === 'faab'}
          auction={s.draftType === 'auction' && b.league.status !== 'season'}
          isCommish={t.owner === b.league.commissioner}
          canRemove={b.league.status === 'setup' && t.owner !== b.league.commissioner}
          busy={busy}
          onSave={(edit) => run(`t${t.id}`, `${edit.name || t.name} saved.`, () => commishTeam(t.id, edit))}
          onLineup={() => router.push({ pathname: '/hosted/[id]/lineup', params: { id: b.league.id, team: t.id } })}
          onRemove={() =>
            Alert.alert(`Remove ${t.name}?`, 'They can join again with the code.', [
              { text: 'Keep', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => run(`r${t.id}`, `${t.name} removed.`, async () => {
                  await commishRemoveTeam(t.id);
                  await syncLeagues().catch(() => undefined);
                }),
              },
            ])
          }
          onTransfer={() =>
            Alert.alert(`Make ${t.name}'s owner the commissioner?`, 'You lose these tools.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Hand it over',
                onPress: () => run(`c${t.id}`, `${t.name}'s owner is now the commissioner.`, () => commishTransfer(b.league.id, t.id)),
              },
            ])
          }
        />
      ))}
    </Screen>
  );
}

function TeamEditor({
  team,
  divisions,
  showWaivers,
  faab,
  auction,
  isCommish,
  canRemove,
  busy,
  onSave,
  onLineup,
  onRemove,
  onTransfer,
}: {
  team: TeamRow;
  divisions: string[];
  showWaivers: boolean;
  faab: boolean;
  auction: boolean;
  isCommish: boolean;
  canRemove: boolean;
  busy: string | null;
  onSave: (edit: { name: string; division: number | null; waiverRank: number | null; faab: number | null; budget: number | null }) => void;
  onLineup: () => void;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [division, setDivision] = useState(team.division == null ? 'none' : String(team.division));
  const [rank, setRank] = useState(team.waiverRank == null ? '' : String(team.waiverRank));
  const [money, setMoney] = useState(String(team.faab));
  const [budget, setBudget] = useState(String(team.budget));
  const int = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

  return (
    <Card>
      <CardHead title={team.name.toUpperCase()} note={isCommish ? 'commissioner' : undefined} />
      <Field label="NAME" value={name} onChangeText={setName} autoCapitalize="words" />
      {divisions.length ? (
        <>
          <Text style={st.lbl}>DIVISION</Text>
          <Chips
            items={[{ id: 'none', label: 'NONE' }, ...divisions.map((d, i) => ({ id: String(i), label: d.toUpperCase() }))]}
            value={division}
            onChange={setDivision}
          />
        </>
      ) : null}
      {showWaivers ? (
        <View style={st.nums}>
          <Num label="WAIVER #" value={rank} onChange={setRank} />
          {faab ? <Num label="FAAB $" value={money} onChange={setMoney} /> : null}
        </View>
      ) : null}
      {auction ? (
        <View style={st.nums}>
          <Num label="AUCTION $" value={budget} onChange={setBudget} />
        </View>
      ) : null}
      <View style={st.btns}>
        <Mini
          label="SAVE"
          busy={busy === `t${team.id}`}
          onPress={() =>
            onSave({
              name,
              division: division === 'none' ? null : Number(division),
              waiverRank: showWaivers ? int(rank) : null,
              faab: showWaivers && faab ? int(money) : null,
              budget: auction ? int(budget) : null,
            })
          }
        />
        <Mini label="SET LINEUP" ghost onPress={onLineup} />
        {!isCommish ? <Mini label="MAKE COMMISSIONER" ghost onPress={onTransfer} /> : null}
        {canRemove ? <Mini label="REMOVE" ghost onPress={onRemove} /> : null}
      </View>
    </Card>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={st.lbl}>{label}</Text>
      <TextInput style={st.box} keyboardType="number-pad" value={value} onChangeText={onChange} />
    </View>
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
    title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4 },
    body: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, marginTop: 6, marginBottom: 6, lineHeight: 18 },
    meta: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 6 },
    lbl: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1.2, marginTop: 12, marginBottom: 6 },
    prow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, gap: 10, borderRadius: 8 },
    on: { backgroundColor: colors.surfaceAlt },
    ppos: { width: 44, fontFamily: fonts.pixel, fontSize: 7.5, color: colors.accent },
    pname: { flex: 1, fontSize: 14, fontFamily: fonts.bodyMedium, color: colors.text },
    nums: { flexDirection: 'row', gap: 12 },
    box: {
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
    btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    mini: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
    miniGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
    miniT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.onAccent, letterSpacing: 1 },
  })
);
