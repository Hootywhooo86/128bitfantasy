import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { LeagueSettingsEditor } from '@/components/LeagueSettingsEditor';
import { Button, Empty, Field, Note, Screen } from '@/components/ui';
import { leagueBundle, updateLeague, type LeagueBundle } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { settingsProblems } from '@/src/leagues/settings';
import type { LeagueSettings } from '@/src/leagues/types';

/** League settings: everyone can read them; the commissioner can change them. */
export default function LeagueSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<LeagueBundle | null>(null);
  const [settings, setSettings] = useState<LeagueSettings | null>(null);
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(10);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    leagueBundle(id).then(
      (nb) => {
        setB(nb);
        setSettings(nb.league.settings);
        setName(nb.league.name);
        setTeams(nb.league.maxTeams);
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  }, [id]);

  if (!b || !settings) {
    return (
      <Screen section="League Settings" back>
        {error ? <Note tone="error">{error}</Note> : <Empty title="LOADING" body="Reading the league…" />}
      </Screen>
    );
  }

  const commish = b.me === b.league.commissioner;
  const locked = b.league.status !== 'setup';
  const problems = settingsProblems(b.league.sport, settings, teams);

  async function save() {
    if (!b || !settings) return;
    setError(null);
    setMsg(null);
    if (problems.length) return setError(problems.join(' '));
    setBusy(true);
    try {
      await updateLeague(b.league.id, name, teams, settings);
      setMsg('Saved. Everyone sees the new settings next time they open the league.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen section="League Settings" back>
      {commish ? (
        <Field label="LEAGUE NAME" value={name} onChangeText={setName} autoCapitalize="words" />
      ) : (
        <Text style={st.title}>{b.league.name}</Text>
      )}
      {commish && locked ? <Note>The draft has happened, so the format and lineup are locked. Scoring, IR, playoffs, waivers and trades can still change.</Note> : null}
      {!commish ? <Note>Only the commissioner can change these.</Note> : null}
      <LeagueSettingsEditor
        sport={b.league.sport}
        value={settings}
        onChange={setSettings}
        teams={teams}
        onTeams={commish && !locked ? (n) => setTeams(Math.max(n, b.teams.length)) : undefined}
        locked={locked}
        readOnly={!commish}
      />
      {msg ? <Note>{msg}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      {commish ? <Button label="SAVE SETTINGS" busy={busy} onPress={save} /> : null}
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4, marginBottom: 8 },
  })
);
