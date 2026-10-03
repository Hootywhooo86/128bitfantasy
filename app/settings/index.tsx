import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, CardHead, Field, Label, MenuRow, Note, Screen } from '@/components/ui';
import { getProviderMeta } from '@/lib/ai/ai-coach';
import { getAiSettings, type AiSettings } from '@/lib/ai/settings';
import { ACCENTS, accentName, normalizeHex, tooDark, useAccent } from '@/lib/accent';
import { alertsEnabled, alertsSupported, disableAlerts, enableAlerts } from '@/lib/alerts';
import { setBackgroundRefresh } from '@/lib/background';
import { describeNetworkFailure } from '@/lib/net-errors';
import { useFeed } from '@/lib/storage/feed';
import { getConnections } from '@/lib/storage/connections';
import { canCheckApis, lastHealth, runHealthCheck } from '@/lib/storage/health';
import { saveAccent, usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { checkForUpdate, installedReleaseTag, type UpdateCheck } from '@/lib/update-check';
import type { HealthReport } from '@/src/providers/health';
import { accessLabel, PROVIDER_INFO } from '@/src/providers/info';
import { PROVIDER_ORDER } from '@/src/providers/registry';
import type { Connection } from '@/src/providers/types';
import { ageLabel, cachedLeagues, lastSyncedAt, syncLeagues } from '@/src/sports/hub';
import type { League } from '@/src/sports/models';
import { visibleOnHome } from '@/src/sports/prefs';

export default function Settings() {
  const router = useRouter();
  const accent = useAccent();
  const prefs = usePrefs();
  const [conns, setConns] = useState<Connection[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [synced, setSynced] = useState<number | null>(null);
  const [busy, setBusy] = useState<'sync' | 'api' | 'app' | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [hex, setHex] = useState('');
  const [alertsOn, setAlertsOn] = useState(false);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const feed = useFeed();

  const load = useCallback(() => {
    getConnections().then(setConns);
    cachedLeagues().then(setLeagues);
    getAiSettings().then(setAi);
    lastHealth().then(setHealth);
    lastSyncedAt().then(setSynced);
    alertsEnabled().then(setAlertsOn);
  }, []);
  useFocusEffect(load);

  const signedIn = new Set(conns.map((c) => c.provider));
  const shown = visibleOnHome(leagues, prefs).length;

  async function syncNow() {
    setBusy('sync');
    setSyncMsg(null);
    try {
      const r = await syncLeagues();
      setLeagues(r.leagues);
      setSynced(Date.now());
      setSyncMsg(
        r.errors.length
          ? r.errors.map((e) => `${PROVIDER_INFO[e.provider].label}: ${describeNetworkFailure(new Error(e.message), 'the sync')}`).join('\n')
          : `${r.leagues.length} league${r.leagues.length === 1 ? '' : 's'} synced.`
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleAlerts(on: boolean) {
    setAlertMsg(null);
    if (on) {
      const why = await enableAlerts();
      if (why) return setAlertMsg(why);
    } else {
      await disableAlerts();
    }
    await setBackgroundRefresh(on).catch(() => undefined);
    setAlertsOn(on);
  }

  async function copyFeed() {
    await Clipboard.setStringAsync(JSON.stringify(feed, null, 2));
    setCopied(true);
  }

  async function checkApis() {
    setBusy('api');
    try {
      setHealth(await runHealthCheck());
    } finally {
      setBusy(null);
    }
  }

  async function checkApp() {
    setBusy('app');
    try {
      setUpdate(await checkForUpdate());
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen section="Settings" back right="none">
      <Label>SIGN IN · YOUR FANTASY ACCOUNTS</Label>
      {PROVIDER_ORDER.map((p) => {
        const info = PROVIDER_INFO[p];
        const n = leagues.filter((l) => l.provider === p).length;
        return (
          <MenuRow
            key={p}
            icon={signedIn.has(p) ? '●' : '○'}
            name={info.label}
            sub={`${info.official ? 'Official API' : 'Unofficial'} · API ${accessLabel(info.apiAccess).toLowerCase()} · this app read only`}
            value={signedIn.has(p) ? `${n} league${n === 1 ? '' : 's'}` : 'Sign in'}
            onPress={() => router.push({ pathname: '/settings/account/[provider]', params: { provider: p } })}
          />
        );
      })}

      <Label>MY TEAMS</Label>
      <MenuRow
        icon="☰"
        name="Choose teams to show"
        sub="Only teams you're in show on Home. Hide any you don't want to see, or pick your team where we couldn't tell."
        value={leagues.length ? `${shown} of ${leagues.length}` : undefined}
        onPress={() => router.push('/settings/teams')}
      />

      <Label>COLORS</Label>
      <Card>
        <CardHead title="ACCENT" note={accentName(accent)} />
        <View style={st.swatches}>
          {ACCENTS.map((a) => (
            <Pressable
              key={a.hex}
              onPress={() => saveAccent(a.hex)}
              style={[st.swatch, { backgroundColor: a.hex }, a.hex === accent && st.swatchOn]}
              accessibilityLabel={a.name}
            />
          ))}
        </View>
        <Field
          label="CUSTOM HEX"
          value={hex}
          onChangeText={setHex}
          placeholder={accent}
          onSubmitEditing={() => {
            const h = normalizeHex(hex);
            if (h && !tooDark(h)) saveAccent(h);
          }}
          hint={
            hex && !normalizeHex(hex)
              ? 'Use a hex colour like #ff8800.'
              : hex && normalizeHex(hex) && tooDark(normalizeHex(hex)!)
                ? "Too dark to see on black — pick something brighter."
                : 'Any colour you like. Win/loss/injury colours stay fixed so they always mean the same thing.'
          }
        />
        {normalizeHex(hex) && !tooDark(normalizeHex(hex)!) ? (
          <Button label="USE THIS COLOR" kind="ghost" onPress={() => saveAccent(normalizeHex(hex)!)} />
        ) : null}
      </Card>

      <Label>GAME-DAY ALERTS</Label>
      <Card>
        <View style={st.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.switchT}>Alerts</Text>
            <Text style={st.body}>
              A notification when a starter is ruled out, a slot is empty, or you win or lose. The phone checks your teams in the
              background — usually every 30 minutes or more, whenever your phone allows.
            </Text>
          </View>
          <Switch
            value={alertsOn}
            onValueChange={toggleAlerts}
            disabled={!alertsSupported}
            trackColor={{ true: colors.accent, false: colors.track }}
            thumbColor={colors.text}
          />
        </View>
        {alertMsg ? <Note tone="error">{alertMsg}</Note> : null}
      </Card>

      <Label>128BIT FEED</Label>
      <Card>
        <CardHead title="YOUR EVENTS" note={`${feed.length} saved`} />
        <Text style={st.body}>
          Wins, losses and lineup fixes go into the shared 128bit feed, ready for 128bitlife quests and XP.
        </Text>
        {feed.length === 0 ? (
          <Text style={st.body}>Nothing yet — events appear as your leagues refresh.</Text>
        ) : (
          feed.slice(0, 5).map((e) => (
            <View key={e.id} style={st.hrow}>
              <Text style={[st.hdot, { color: e.type === 'matchup.won' || e.type === 'lineup.fixed' ? colors.win : e.type === 'lineup.problem' || e.type === 'matchup.lost' ? colors.loss : colors.warn }]}>●</Text>
              <Text style={st.hdet} numberOfLines={2}>{`${e.title} · ${e.league.name}`}</Text>
            </View>
          ))
        )}
        {feed.length ? <Button label={copied ? 'COPIED' : 'COPY FEED (JSON)'} kind="ghost" onPress={copyFeed} /> : null}
      </Card>

      <Label>COACHES CORNER AI</Label>
      <MenuRow
        icon="✦"
        name={ai ? getProviderMeta(ai.provider).label : 'AI provider'}
        sub={ai ? `${ai.model} · ${ai.hasKey ? 'key saved' : 'no key yet'}` : undefined}
        value={ai?.hasKey ? 'Ready' : 'Set up'}
        onPress={() => router.push('/settings/ai')}
      />

      <Label>UPDATES</Label>
      <Card>
        <CardHead title="SYNC TEAMS" note={synced ? `last ${ageLabel(synced)}` : 'never'} />
        <Button label="SYNC ALL NOW" onPress={syncNow} busy={busy === 'sync'} />
        {syncMsg ? <Note>{syncMsg}</Note> : null}
      </Card>

      <Card>
        <CardHead title="FANTASY APIS" note={health ? `checked ${ageLabel(health.checkedAt)}` : 'not checked'} />
        <Text style={st.body}>
          Checks every provider still answers the way the app expects. Runs by itself once a day; providers change their APIs
          without warning.
        </Text>
        {health
          ? PROVIDER_ORDER.map((p) => {
              const h = health.results[p];
              if (!h) return null;
              return (
                <View key={p} style={st.hrow}>
                  <Text style={[st.hdot, { color: h.status === 'ok' ? colors.win : h.status === 'changed' ? colors.warn : colors.loss }]}>●</Text>
                  <Text style={st.hname}>{PROVIDER_INFO[p].label}</Text>
                  <Text style={st.hdet} numberOfLines={2}>{`${h.status.toUpperCase()} · ${h.detail}`}</Text>
                </View>
              );
            })
          : null}
        {canCheckApis ? (
          <Button label="CHECK FANTASY APIS" kind="ghost" onPress={checkApis} busy={busy === 'api'} />
        ) : (
          <Note>Web browsers block these checks for most providers. They run in the phone app, and daily on GitHub.</Note>
        )}
      </Card>

      <Card>
        <CardHead title="APP VERSION" note={installedReleaseTag() ?? 'dev build'} />
        <Button label="CHECK FOR APP UPDATE" kind="ghost" onPress={checkApp} busy={busy === 'app'} />
        {update ? <UpdateResult r={update} /> : null}
      </Card>

      <Label>ABOUT</Label>
      <Note>
        128BIT FANTASY is part of the 128bit family. Read-only everywhere: it never changes a lineup or makes a move, even
        where a provider&apos;s API could. Advice only — for the game, not for betting.
      </Note>
    </Screen>
  );
}

function UpdateResult({ r }: { r: UpdateCheck }) {
  const open = (u: string) => Linking.openURL(u).catch(() => undefined);
  switch (r.status) {
    case 'current':
      return <Note>You&apos;re on the newest release.</Note>;
    case 'available':
    case 'unknown-build':
      return (
        <>
          <Note>{r.status === 'available' ? `${r.latest.tag} is available.` : `The newest release is ${r.latest.tag}.`}</Note>
          <Button label={r.latest.apkUrl ? 'DOWNLOAD APK' : 'OPEN RELEASE PAGE'} onPress={() => open(r.latest.apkUrl ?? r.latest.pageUrl)} />
        </>
      );
    case 'hidden':
      return (
        <>
          <Note>Releases are only visible when signed in to GitHub.</Note>
          <Button label="OPEN RELEASES" kind="ghost" onPress={() => open(r.pageUrl)} />
        </>
      );
    default:
      return <Note tone="error">{r.message}</Note>;
  }
}

const st = themedStyles(() =>
  StyleSheet.create({
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
    swatch: { width: 38, height: 38, borderRadius: 8, borderWidth: 2, borderColor: colors.border },
    swatchOn: { borderColor: colors.text, transform: [{ scale: 1.08 }] },
    body: { fontSize: 12.5, color: colors.textMuted, lineHeight: 19, fontFamily: fonts.body, marginBottom: 8 },
    hrow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    switchT: { fontSize: 15, fontFamily: fonts.bodySemi, color: colors.text, marginBottom: 4 },
    hdot: { fontSize: 11 },
    hname: { width: 86, fontSize: 13.5, fontFamily: fonts.bodySemi, color: colors.text },
    hdet: { flex: 1, fontSize: 12, color: colors.textMuted, fontFamily: fonts.body },
  })
);

