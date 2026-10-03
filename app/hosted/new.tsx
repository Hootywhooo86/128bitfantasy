import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { LeagueSettingsEditor } from '@/components/LeagueSettingsEditor';
import { Button, Card, Chips, Field, Note, Screen } from '@/components/ui';
import { createLeague } from '@/lib/leagues/data';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { HOSTED_SPORTS, type HostedSport } from '@/src/leagues/scoring';
import { defaultSettings, seasonFor, settingsProblems } from '@/src/leagues/settings';
import type { LeagueSettings } from '@/src/leagues/types';
import { syncLeagues } from '@/src/sports/hub';

const PLACEHOLDER: Record<HostedSport, string> = {
  nhl: 'Saturday Night Puck',
  nfl: 'Sunday Funday',
  nba: 'Buckets League',
  mlb: 'Boys of Summer',
};

export default function NewLeague() {
  const router = useRouter();
  const [sport, setSport] = useState<HostedSport>('nhl');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teams, setTeams] = useState(10);
  const [settings, setSettings] = useState<LeagueSettings>(defaultSettings('nhl'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = settingsProblems(sport, settings, teams);

  async function create() {
    setError(null);
    if (!name.trim() || !teamName.trim()) return setError('Name the league and your team.');
    if (problems.length) return setError(problems.join(' '));
    setBusy(true);
    try {
      const id = await createLeague({ name, sport, season: seasonFor(sport), maxTeams: teams, teamName, settings });
      await syncLeagues().catch(() => undefined);
      router.replace({ pathname: '/hosted/[id]', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen section="New League" back>
      <Text style={st.title}>Start a league</Text>
      <Text style={st.body}>Everything can be changed before the draft. After it, the lineup and format lock; scoring, waivers and trades can still change.</Text>
      <Card>
        <Chips
          items={HOSTED_SPORTS}
          value={sport}
          onChange={(v) => {
            setSport(v);
            setSettings(defaultSettings(v));
          }}
        />
        <Field label="LEAGUE NAME" value={name} onChangeText={setName} autoCapitalize="words" placeholder={PLACEHOLDER[sport]} />
        <Field label="YOUR TEAM NAME" value={teamName} onChangeText={setTeamName} autoCapitalize="words" />
      </Card>
      <LeagueSettingsEditor sport={sport} value={settings} onChange={setSettings} teams={teams} onTeams={setTeams} />
      {problems.length ? <Note tone="error">{problems.join(' ')}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      <Button label="CREATE LEAGUE" busy={busy} onPress={create} />
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4 },
    body: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, marginTop: 8, marginBottom: 8, lineHeight: 18 },
  })
);
