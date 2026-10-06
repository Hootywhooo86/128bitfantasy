import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';
import { Button, Card, CardHead, Field, Label, MenuRow, Note, Screen } from '@/components/ui';
import {
  hostedConn,
  saveHostedConn,
  sendEmailCode,
  signInQuick,
  signOutHosted,
  deleteHostedAccount,
  verifyEmailCode,
  whoAmI,
  type HostedConn,
} from '@/lib/leagues/client';
import { joinLeague, myHostedLeagues, type LeagueRow } from '@/lib/leagues/data';
import { removeConnection } from '@/lib/storage/connections';
import { defaultHostedProject } from '@/src/providers/hosted-default';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { SPORT_NAMES, type HostedSport } from '@/src/leagues/scoring';
import { FORMAT_LABELS } from '@/src/leagues/types';
import { PROVIDER_INFO } from '@/src/providers/info';
import { syncLeagues } from '@/src/sports/hub';

const SPORT_ICON: Record<HostedSport, string> = { nhl: '◆', nfl: '◈', nba: '●', mlb: '◇' };

const STATUS: Record<string, string> = { setup: 'Waiting for friends', drafting: 'Drafting now', season: 'In season', done: 'Season over' };

export default function Hosted() {
  const router = useRouter();
  const [conn, setConn] = useState<HostedConn | null | undefined>(undefined);
  const [me, setMe] = useState<{ id: string; label: string } | null>(null);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [f, setF] = useState({
    url: '',
    key: '',
    email: '',
    code: '',
    codeSent: false,
    teamName: '',
    joinCode: '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  // The app's own league server, when this build has one. "Different project" is the advanced path.
  const builtIn = defaultHostedProject();
  const [picking, setPicking] = useState(false);
  const onBuiltIn = !!builtIn && !!conn && conn.url === builtIn.url;

  const load = useCallback(() => {
    hostedConn().then(async (c) => {
      setConn(c);
      if (!c) return;
      setF((x) => ({ ...x, url: x.url || c.url, key: x.key || c.anonKey }));
      try {
        const who = await whoAmI();
        setMe(who);
        if (who) setLeagues(await myHostedLeagues());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, []);
  useFocusEffect(load);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const info = PROVIDER_INFO.bit128;

  if (conn === undefined) return <Screen section="128bit Leagues" back>{null}</Screen>;

  if (!conn || picking) {
    return (
      <Screen section="128bit Leagues" back>
        {builtIn ? (
          <Button label="USE THE 128BIT SERVER INSTEAD" kind="ghost" onPress={() => run('builtin', async () => { await removeConnection('bit128'); setPicking(false); load(); })} />
        ) : null}
        <Text style={st.title}>Run your own league</Text>
        <Text style={st.body}>
          Hockey, football, basketball or baseball with friends: snake, linear or auction drafts, keepers and dynasty, daily lineups,
          waivers, trades, live scoring from the leagues&apos; own stat feeds. It lives in a
          free Supabase project the commissioner owns — no fees, no ads.
        </Text>
        <Card>
          <CardHead title="SET UP · ONCE PER LEAGUE GROUP" />
          {info.steps.map((s, i) => (
            <Text key={s} style={st.step}>{`${i + 1}. ${s}`}</Text>
          ))}
          {info.help.map((h) => (
            <Text key={h.url} style={st.link} onPress={() => Linking.openURL(h.url).catch(() => undefined)}>
              {`${h.label} ↗`}
            </Text>
          ))}
        </Card>
        <Field label="PROJECT URL" value={f.url} onChangeText={set('url')} placeholder="https://abcdefgh.supabase.co" />
        <Field
          label="PUBLISHABLE (ANON) KEY"
          value={f.key}
          onChangeText={set('key')}
          placeholder="sb_publishable_… or eyJ…"
          hint="This key is designed to be shared — the database only lets people see leagues they're in."
        />
        {error ? <Note tone="error">{error}</Note> : null}
        <Button
          label="CONNECT"
          busy={busy === 'save'}
          onPress={() =>
            run('save', async () => {
              if (!f.url.trim() || !f.key.trim()) throw new Error('Paste both the Project URL and the key.');
              setConn(await saveHostedConn(f.url, f.key));
              setPicking(false);
            })
          }
        />
      </Screen>
    );
  }

  if (!me) {
    return (
      <Screen section="128bit Leagues" back>
        <Text style={st.title}>Sign in</Text>
        <Text style={st.body}>{onBuiltIn ? 'One account for all your 128BIT leagues.' : `Project: ${conn.url.replace(/^https:\/\//, '')}`}</Text>
        {error ? <Note tone="error">{error}</Note> : null}
        <Card>
          <CardHead title="QUICK" note="this phone only" />
          <Text style={st.body}>No email. Your team stays on this phone — switching phones later means a new account.</Text>
          <Button label="QUICK SIGN-IN" busy={busy === 'quick'} onPress={() => run('quick', async () => { await signInQuick(); load(); })} />
        </Card>
        <Card>
          <CardHead title="EMAIL CODE" note="keeps your team on any phone" />
          <Field label="EMAIL" value={f.email} onChangeText={set('email')} keyboardType="email-address" placeholder="you@example.com" />
          {f.codeSent ? (
            <>
              <Field label="CODE FROM THE EMAIL" value={f.code} onChangeText={set('code')} keyboardType="number-pad" />
              <Button
                label="SIGN IN"
                busy={busy === 'verify'}
                onPress={() => run('verify', async () => { await verifyEmailCode(f.email, f.code); load(); })}
              />
            </>
          ) : (
            <Button
              label="EMAIL ME A CODE"
              kind="ghost"
              busy={busy === 'send'}
              onPress={() =>
                run('send', async () => {
                  if (!f.email.includes('@')) throw new Error('Enter your email.');
                  await sendEmailCode(f.email);
                  setF((x) => ({ ...x, codeSent: true }));
                })
              }
            />
          )}
          <Note>Getting a link instead of a code? The commissioner adds {'{{ .Token }}'} to Supabase → Authentication → Emails → Magic Link.</Note>
        </Card>
        <Button
          label="USE A DIFFERENT PROJECT"
          kind="ghost"
          onPress={() =>
            run('forget', async () => {
              if (!onBuiltIn) await removeConnection('bit128');
              setF((x) => ({ ...x, url: '', key: '' }));
              setPicking(true);
            })
          }
        />
      </Screen>
    );
  }

  return (
    <Screen section="128bit Leagues" back onRefresh={load} refreshing={false}>
      <Text style={st.who}>{`SIGNED IN · ${me.label.toUpperCase()}`}</Text>
      {error ? <Note tone="error">{error}</Note> : null}

      <Label>MY LEAGUES</Label>
      {leagues.length ? (
        leagues.map((l) => (
          <MenuRow
            key={l.id}
            icon={SPORT_ICON[l.sport]}
            name={l.name}
            sub={`${SPORT_NAMES[l.sport]} · ${l.season} · ${FORMAT_LABELS[l.settings.format]} · ${STATUS[l.status] ?? l.status} · code ${l.inviteCode}`}
            onPress={() => router.push({ pathname: '/hosted/[id]', params: { id: l.id } })}
          />
        ))
      ) : (
        <Note>No leagues yet. Start one, or join a friend&apos;s with their 6-letter code.</Note>
      )}

      <Label>START A LEAGUE</Label>
      <MenuRow
        icon="+"
        name="NEW LEAGUE"
        sub="Hockey, football, basketball or baseball · format, roster, scoring, draft, keepers, playoffs, waivers, trades"
        onPress={() => router.push('/hosted/new')}
      />

      <Label>JOIN A FRIEND&apos;S LEAGUE</Label>
      <Card>
        <Field label="INVITE CODE" value={f.joinCode} onChangeText={(v) => set('joinCode')(v.toUpperCase())} autoCapitalize="characters" placeholder="ABC234" />
        <Field label="YOUR TEAM NAME" value={f.teamName} onChangeText={set('teamName')} autoCapitalize="words" />
        <Button
          label="JOIN"
          kind="ghost"
          busy={busy === 'join'}
          onPress={() =>
            run('join', async () => {
              if (!f.joinCode.trim() || !f.teamName.trim()) throw new Error('Enter the code and your team name.');
              const id = await joinLeague(f.joinCode, f.teamName);
              await syncLeagues().catch(() => undefined);
              router.push({ pathname: '/hosted/[id]', params: { id } });
            })
          }
        />
      </Card>

      <Button label="SIGN OUT" kind="ghost" onPress={() => run('out', async () => { await signOutHosted(); setMe(null); setLeagues([]); })} />
      <Button
        label="DELETE MY ACCOUNT"
        kind="danger"
        busy={busy === 'delete'}
        onPress={() =>
          Alert.alert(
            'Delete your 128BIT LEAGUES account?',
            "This can't be undone. Leagues that haven't drafted lose your team. In leagues that have started, your team stays (marked as left) so everyone can finish; leagues you run pass to another member.",
            [
              { text: 'Keep it', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  run('delete', async () => {
                    await deleteHostedAccount();
                    setMe(null);
                    setLeagues([]);
                    await syncLeagues().catch(() => undefined);
                  }),
              },
            ]
          )
        }
      />
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    title: { fontSize: 22, fontFamily: fonts.bodyBold, color: colors.text, marginTop: 4 },
    body: { fontSize: 13.5, color: colors.textMuted, fontFamily: fonts.body, marginTop: 8, marginBottom: 8, lineHeight: 19 },
    step: { fontSize: 13, color: colors.text, fontFamily: fonts.body, marginTop: 6, lineHeight: 18 },
    link: { fontSize: 13, color: colors.accent, fontFamily: fonts.bodyMedium, marginTop: 10 },
    small: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginVertical: 8, lineHeight: 17 },
    who: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1, marginTop: 4 },
  })
);
