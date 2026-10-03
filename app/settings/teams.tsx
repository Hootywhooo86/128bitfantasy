import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Card, Empty, Label, Note, Screen } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { updatePrefs, usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { PROVIDER_INFO } from '@/src/providers/info';
import { PROVIDER_ORDER } from '@/src/providers/registry';
import { cachedLeagues, cachedSnapshot, fetchSnapshot } from '@/src/sports/hub';
import type { League, Team } from '@/src/sports/models';
import { leagueKey, pickTeam, toggleHidden, withMyTeam } from '@/src/sports/prefs';

/**
 * Which teams show on Home. Every league found on a signed-in account is
 * listed; a switch shows or hides it, and where the provider couldn't say
 * which team is yours, you pick it.
 */
export default function MyTeams() {
  const prefs = usePrefs();
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [teams, setTeams] = useState<Record<string, Team[]>>({});
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      cachedLeagues().then(setLeagues);
    }, [])
  );

  async function expand(l: League) {
    const k = leagueKey(l);
    if (open === k) return setOpen(null);
    setOpen(k);
    setError(null);
    if (teams[k]) return;
    try {
      const s = (await cachedSnapshot(l)) ?? (await fetchSnapshot(l));
      setTeams((x) => ({ ...x, [k]: s.teams }));
    } catch (e) {
      setError(describeNetworkFailure(e, 'the team list'));
    }
  }

  if (leagues && leagues.length === 0) {
    return (
      <Screen section="My Teams" back right="none">
        <Empty title="NO LEAGUES YET" body="Sign in to a fantasy account in Settings first." />
      </Screen>
    );
  }

  return (
    <Screen section="My Teams" back right="none">
      <Note>Home only shows leagues where we know your team and the switch is on. Tap a league to change which team is yours.</Note>
      {PROVIDER_ORDER.map((p) => {
        const list = (leagues ?? []).filter((l) => l.provider === p);
        if (!list.length) return null;
        return (
          <View key={p}>
            <Label>{PROVIDER_INFO[p].label.toUpperCase()}</Label>
            {list.map((raw) => {
              const l = withMyTeam(raw, prefs);
              const k = leagueKey(l);
              const shown = !prefs.hidden.includes(k);
              const mine = teams[k]?.find((t) => t.id === l.myTeamId)?.name;
              return (
                <Card key={k}>
                  <View style={st.row}>
                    <Pressable style={{ flex: 1 }} onPress={() => expand(l)}>
                      <Text style={st.name} numberOfLines={1}>{l.name}</Text>
                      <Text style={[st.sub, !l.myTeamId && { color: colors.warn }]}>
                        {`${l.sport.toUpperCase()} · ${l.myTeamId ? (mine ? `You: ${mine}` : 'Your team found') : 'Tap to pick your team'}`}
                      </Text>
                    </Pressable>
                    <Switch
                      value={shown}
                      onValueChange={(v) => updatePrefs((x) => toggleHidden(x, k, !v))}
                      trackColor={{ true: colors.accent, false: colors.track }}
                      thumbColor={colors.text}
                    />
                  </View>
                  {open === k ? (
                    <View style={{ marginTop: 10 }}>
                      {error ? <Note tone="error">{error}</Note> : null}
                      {(teams[k] ?? []).map((t) => (
                        <Pressable key={t.id} style={[st.team, t.id === l.myTeamId && st.teamOn]} onPress={() => updatePrefs((x) => pickTeam(x, k, t.id))}>
                          <Text style={[st.teamT, t.id === l.myTeamId && { color: colors.accent }]}>{t.name}</Text>
                          <Text style={st.teamO}>{t.owner ?? ''}</Text>
                        </Pressable>
                      ))}
                      {prefs.myTeam[k] ? (
                        <Pressable onPress={() => updatePrefs((x) => pickTeam(x, k, null))}>
                          <Text style={st.reset}>USE THE PROVIDER&apos;S ANSWER INSTEAD</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        );
      })}
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { fontSize: 15, fontFamily: fonts.bodySemi, color: colors.text },
    sub: { fontSize: 12.5, color: colors.textDim, marginTop: 5, fontFamily: fonts.body },
    team: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
    teamOn: { backgroundColor: colors.surfaceAlt },
    teamT: { fontSize: 14, color: colors.text, fontFamily: fonts.bodyMedium },
    teamO: { fontSize: 12.5, color: colors.textDim, fontFamily: fonts.body },
    reset: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textMuted, letterSpacing: 1, marginTop: 10 },
  })
);
