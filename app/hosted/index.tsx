import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { Button, Card, CardHead, Chips, Field, Label, MenuRow, Note, Screen } from '@/components/ui';
import {
  hostedConn,
  saveHostedConn,
  sendEmailCode,
  signInQuick,
  signOutHosted,
  verifyEmailCode,
  whoAmI,
  type HostedConn,
} from '@/lib/leagues/client';
import { createLeague, joinLeague, myHostedLeagues, type LeagueRow } from '@/lib/leagues/data';
import { removeConnection } from '@/lib/storage/connections';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { nhlSeasonFor } from '@/src/leagues/nhl';
import type { HostedSport } from '@/src/leagues/scoring';
import { PROVIDER_INFO } from '@/src/providers/info';
import { syncLeagues } from '@/src/sports/hub';

const SPORTS: { id: HostedSport; label: string }[] = [
  { id: 'nhl', label: 'HOCKEY' },
  { id: 'nfl', label: 'FOOTBALL' },
];

const STATUS: Record<string, string> = { setup: 'Waiting for friends', drafting: 'Drafting now', season: 'In season', done: 'Season over' };

/** The season a new league plays: NHL numbers it 20262027, the NFL by the year it kicks off. */
function seasonFor(sport: HostedSport, now = new Date()): string {
  if (sport === 'nhl') return nhlSeasonFor(now);
  return String(now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
}

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
    name: '',
    sport: 'nhl' as HostedSport,
    teams: '10',
    teamName: '',
    joinCode: '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

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

  if (!conn) {
    return (
      <Screen section="128bit Leagues" back>
        <Text style={st.title}>Run your own league</Text>
        <Text style={st.body}>
          Hockey or football with friends: snake draft, daily lineups, free agents, live scoring from the NHL and NFL stat feeds. It lives in a
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
        <Text style={st.body}>{`Project: ${conn.url.replace(/^https:\/\//, '')}`}</Text>
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
          onPress={() => run('forget', async () => { await removeConnection('bit128'); setConn(null); })}
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
            icon={l.sport === 'nhl' ? '◆' : '◈'}
            name={l.name}
            sub={`${l.sport === 'nhl' ? 'Hockey' : 'Football'} · ${STATUS[l.status] ?? l.status} · code ${l.inviteCode}`}
            onPress={() => router.push({ pathname: '/hosted/[id]', params: { id: l.id } })}
          />
        ))
      ) : (
        <Note>No leagues yet. Start one, or join a friend&apos;s with their 6-letter code.</Note>
      )}

      <Label>START A LEAGUE</Label>
      <Card>
        <Chips items={SPORTS} value={f.sport} onChange={(v) => setF((x) => ({ ...x, sport: v }))} />
        <Field label="LEAGUE NAME" value={f.name} onChangeText={set('name')} autoCapitalize="words" placeholder="Saturday Night Puck" />
        <Field label="TEAMS (2–20)" value={f.teams} onChangeText={set('teams')} keyboardType="number-pad" />
        <Field label="YOUR TEAM NAME" value={f.teamName} onChangeText={set('teamName')} autoCapitalize="words" />
        <Text style={st.small}>
          {f.sport === 'nhl'
            ? 'Head-to-head points. 2 C · 2 LW · 2 RW · 4 D · 1 UTIL · 2 G · 4 bench. Goal 3, assist 2, PPG +1, shot 0.4, hit 0.2, block 0.4, +/- 0.5 · goalie win 4, save 0.2, GA −1, shutout 3.'
            : 'Head-to-head points, full PPR (Sleeper\'s scoring). QB · 2 RB · 2 WR · TE · FLEX · K · DEF · 6 bench.'}
        </Text>
        <Button
          label="CREATE LEAGUE"
          busy={busy === 'create'}
          onPress={() =>
            run('create', async () => {
              const n = Number(f.teams);
              if (!f.name.trim() || !f.teamName.trim()) throw new Error('Name the league and your team.');
              if (!Number.isInteger(n) || n < 2 || n > 20) throw new Error('Teams must be 2 to 20.');
              const id = await createLeague({ name: f.name, sport: f.sport, season: seasonFor(f.sport), maxTeams: n, teamName: f.teamName });
              await syncLeagues().catch(() => undefined);
              router.push({ pathname: '/hosted/[id]', params: { id } });
            })
          }
        />
      </Card>

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
