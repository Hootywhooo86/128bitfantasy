import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, CardHead, Chips, Field, Label, Note, Screen } from '@/components/ui';
import { sanitizeApiKey } from '@/lib/api-key';
import { describeNetworkFailure } from '@/lib/net-errors';
import { lastHealth } from '@/lib/storage/health';
import { colors, fonts, themedStyles } from '@/lib/theme';
import type { Health } from '@/src/providers/health';
import { accessLabel, PROVIDER_INFO } from '@/src/providers/info';
import { getConnection, removeConnection, saveConnection } from '@/lib/storage/connections';
import { providerLabel } from '@/src/providers/http';
import type { Connection } from '@/src/providers/types';
import { exchangeYahooCode, yahooAuthorizeUrl } from '@/src/providers/yahoo/oauth';
import { syncLeagues } from '@/src/sports/hub';
import { SPORTS, type ProviderId, type Sport } from '@/src/sports/models';

const splitIds = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export default function Account() {
  const { provider } = useLocalSearchParams<{ provider: ProviderId }>();
  const router = useRouter();
  const [existing, setExisting] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const usedCode = useRef<string | null>(null);

  // One bag of form fields; each provider uses the ones it needs.
  const [f, setF] = useState({
    username: '',
    email: '',
    clientId: '',
    clientSecret: '',
    code: '',
    leagueIds: '',
    espnS2: '',
    swid: '',
    userSecretId: '',
    franchiseId: '',
    sport: 'nfl' as Sport,
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    lastHealth().then((r) => setHealth(r?.results[provider] ?? null));
    getConnection(provider).then((c) => {
      setExisting(c);
      if (!c) return;
      if (c.provider === 'sleeper') setF((x) => ({ ...x, username: c.username }));
      if (c.provider === 'fleaflicker') setF((x) => ({ ...x, email: c.email }));
      if (c.provider === 'yahoo') setF((x) => ({ ...x, clientId: c.clientId, clientSecret: c.clientSecret }));
      if (c.provider === 'mfl')
        setF((x) => ({ ...x, leagueIds: c.leagues.map((l) => l.id).join(', '), franchiseId: c.leagues[0]?.franchiseId ?? '' }));
      if (c.provider === 'fantrax') setF((x) => ({ ...x, userSecretId: c.userSecretId ?? '', leagueIds: c.leagueIds.join(', ') }));
      if (c.provider === 'espn')
        setF((x) => ({ ...x, leagueIds: c.leagues.map((l) => l.id).join(', '), sport: c.leagues[0]?.sport ?? 'nfl', espnS2: c.espnS2 ?? '', swid: c.swid ?? '' }));
    });
  }, [provider]);

  async function build(): Promise<Connection> {
    switch (provider) {
      case 'sleeper':
        if (!f.username.trim()) throw new Error('Enter your Sleeper username.');
        return { provider, username: f.username.trim() };
      case 'fleaflicker':
        if (!f.email.includes('@')) throw new Error('Enter the email on your Fleaflicker account.');
        return { provider, email: f.email.trim(), sport: SPORTS.map((x) => x.id) };
      case 'espn': {
        const ids = splitIds(f.leagueIds);
        if (!ids.length) throw new Error('Enter at least one ESPN league ID — it is the leagueId= number in the league URL.');
        // Keep other sports' leagues from earlier connects.
        const prev = existing?.provider === 'espn' ? existing.leagues.filter((l) => l.sport !== f.sport) : [];
        return {
          provider,
          leagues: [...prev, ...ids.map((id) => ({ id, sport: f.sport }))],
          espnS2: f.espnS2.trim() || null,
          swid: f.swid.trim() || null,
        };
      }
      case 'mfl': {
        const ids = splitIds(f.leagueIds);
        if (!ids.length) throw new Error('Enter at least one MFL league ID — the number after /home/ in the league address.');
        const fr = f.franchiseId.trim();
        if (fr && !/^\d{1,4}$/.test(fr)) throw new Error('Franchise number is up to 4 digits, like 0004.');
        // One franchise number applies to the first league; pick the rest in My Teams.
        return { provider, leagues: ids.map((id, i) => ({ id, franchiseId: i === 0 && fr ? fr : null })) };
      }
      case 'fantrax': {
        const ids = splitIds(f.leagueIds);
        if (!ids.length && !f.userSecretId.trim()) throw new Error('Enter a league ID or your User Secret ID.');
        return { provider, userSecretId: f.userSecretId.trim() || null, leagueIds: ids };
      }
      case 'yahoo': {
        const clientId = sanitizeApiKey(f.clientId);
        const clientSecret = sanitizeApiKey(f.clientSecret);
        if (!clientId || !clientSecret) throw new Error('Enter your Yahoo app Client ID and Client Secret first.');
        const code = f.code.trim();
        // A Yahoo code works exactly once. If this one was already traded for a
        // login (or no new code was pasted), keep that login and just re-sync —
        // sending it again is what made Yahoo say "rejected" on a retry.
        const signedIn = existing?.provider === 'yahoo' && existing.clientId === clientId ? existing : null;
        if (signedIn && (!code || code === usedCode.current)) return { ...signedIn, clientSecret };
        if (!code) throw new Error('Tap SIGN IN WITH YAHOO, approve, then paste the code Yahoo shows you.');
        if (code === usedCode.current) throw new Error('That code was already used. Tap SIGN IN WITH YAHOO for a fresh one.');
        usedCode.current = code;
        const t = await exchangeYahooCode(clientId, clientSecret, code);
        const conn = { provider, clientId, clientSecret, ...t } as const;
        // Saved the moment Yahoo hands over the login, before anything else
        // can fail, so a retry never needs the spent code.
        await saveConnection(conn);
        setExisting(conn);
        return conn;
      }
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const warn = await saveConnection(await build());
      const res = await syncLeagues();
      const mine = res.errors.find((e) => e.provider === provider);
      if (mine) throw new Error(mine.message);
      const n = res.leagues.filter((l) => l.provider === provider).length;
      setInfo(`${n} league${n === 1 ? '' : 's'} found.${warn ? ` ${warn}` : ''}`);
      if (n > 0 && !warn) router.back();
    } catch (e) {
      setError(describeNetworkFailure(e, `the ${providerLabel(provider)} request`));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await removeConnection(provider);
    await syncLeagues();
    router.back();
  }

  return (
    <Screen section={`Sign in · ${providerLabel(provider)}`} back right="none">
      <AboutProvider provider={provider} health={health} signedIn={!!existing} />

      {provider === 'sleeper' && (
        <Card>
          <CardHead title="SLEEPER" note="Official API" />
          <Field label="USERNAME" value={f.username} onChangeText={set('username')} placeholder="your sleeper username" />
          <Note>Sleeper&apos;s API is public and read-only — no password, ever.</Note>
        </Card>
      )}

      {provider === 'fleaflicker' && (
        <Card>
          <CardHead title="FLEAFLICKER" note="Official API" />
          <Field label="EMAIL" value={f.email} onChangeText={set('email')} keyboardType="email-address" placeholder="you@example.com" />
          <Note>Fleaflicker lists a user&apos;s leagues by email. No password needed.</Note>
        </Card>
      )}

      {provider === 'espn' && (
        <Card>
          <CardHead title="ESPN" note="Unofficial" />
          <Label style={{ marginTop: 0 }}>SPORT</Label>
          <Chips items={SPORTS} value={f.sport} onChange={(v) => setF((x) => ({ ...x, sport: v }))} />
          <Field
            label="LEAGUE IDS"
            value={f.leagueIds}
            onChangeText={set('leagueIds')}
            keyboardType="numbers-and-punctuation"
            placeholder="12345678"
            hint="The leagueId= number in your league's URL. Separate several with commas."
          />
          <Field label="ESPN_S2 (PRIVATE LEAGUES)" value={f.espnS2} onChangeText={set('espnS2')} secureTextEntry placeholder="optional" />
          <Field
            label="SWID (PRIVATE LEAGUES)"
            value={f.swid}
            onChangeText={set('swid')}
            placeholder="{XXXXXXXX-XXXX-…}"
            hint="Sign in at espn.com on a computer → DevTools → Application → Cookies → espn.com. Copy espn_s2 and SWID. SWID also tells us which team is yours."
          />
        </Card>
      )}

      {provider === 'mfl' && (
        <Card>
          <CardHead title="MYFANTASYLEAGUE" note="Official API" />
          <Field
            label="LEAGUE IDS"
            value={f.leagueIds}
            onChangeText={set('leagueIds')}
            keyboardType="numbers-and-punctuation"
            placeholder="23456"
            hint="myfantasyleague.com/2026/home/<THIS NUMBER>. Separate several with commas."
          />
          <Field
            label="YOUR FRANCHISE NUMBER (OPTIONAL)"
            value={f.franchiseId}
            onChangeText={set('franchiseId')}
            keyboardType="number-pad"
            placeholder="0004"
            hint="For the first league. Skip it and pick your team in My Teams instead."
          />
        </Card>
      )}

      {provider === 'fantrax' && (
        <Card>
          <CardHead title="FANTRAX" note="Experimental" />
          <Field
            label="LEAGUE IDS"
            value={f.leagueIds}
            onChangeText={set('leagueIds')}
            placeholder="abc123xyz"
            hint="From the league URL: fantrax.com/fantasy/league/<THIS PART>/…"
          />
          <Field
            label="USER SECRET ID (OPTIONAL)"
            value={f.userSecretId}
            onChangeText={set('userSecretId')}
            secureTextEntry
            hint="Fantrax → User Profile. Lists your leagues automatically, though Fantrax often returns none."
          />
        </Card>
      )}

      {provider === 'yahoo' && (
        <Card>
          <CardHead title="YAHOO" note="Official API · OAuth" />
          <Field label="CLIENT ID" value={f.clientId} onChangeText={set('clientId')} />
          <Field label="CLIENT SECRET" value={f.clientSecret} onChangeText={set('clientSecret')} secureTextEntry />
          <Button
            label="SIGN IN WITH YAHOO"
            kind="ghost"
            disabled={!f.clientId.trim()}
            onPress={() => WebBrowser.openBrowserAsync(yahooAuthorizeUrl(f.clientId))}
          />
          <Field label="CODE FROM YAHOO" value={f.code} onChangeText={set('code')} placeholder="paste the code here" />
        </Card>
      )}

      {error ? <Note tone="error">{error}</Note> : null}
      {info ? <Note>{info}</Note> : null}
      <Button label={existing ? 'SAVE & SYNC' : 'SIGN IN'} onPress={save} busy={busy} />
      {existing ? <Button label="SIGN OUT" kind="danger" onPress={disconnect} /> : null}
    </Screen>
  );
}

/**
 * Before the form: what this provider can do, what we do with it, how to get
 * the details, and where to go when it doesn't work.
 */
function AboutProvider({ provider, health, signedIn }: { provider: ProviderId; health: Health | null; signedIn: boolean }) {
  const info = PROVIDER_INFO[provider];
  const tone = !health ? colors.textDim : health.status === 'ok' ? colors.win : health.status === 'changed' ? colors.warn : colors.loss;
  return (
    <Card>
      <CardHead title={info.label.toUpperCase()} note={signedIn ? 'Signed in' : info.official ? 'Official API' : 'Unofficial'} />
      <View style={st.badges}>
        <Badge label={`API: ${accessLabel(info.apiAccess)}`} />
        <Badge label={`THIS APP: ${accessLabel(info.appAccess)}`} accent />
      </View>
      <Text style={st.body}>{info.accessNote}</Text>
      <Text style={st.stepsT}>HOW TO SIGN IN</Text>
      {info.steps.map((step, i) => (
        <Text key={step} style={st.step}>{`${i + 1}. ${step}`}</Text>
      ))}
      <Text style={st.stepsT}>HAVING PROBLEMS?</Text>
      <View style={st.links}>
        {info.help.map((h) => (
          <Pressable key={h.url} style={st.link} onPress={() => WebBrowser.openBrowserAsync(h.url)}>
            <Text style={st.linkT}>{`${h.label} ↗`}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[st.health, { color: tone }]}>
        {health ? `API STATUS: ${health.status.toUpperCase()} · ${health.detail}` : 'API STATUS: NOT CHECKED YET (SETTINGS → FANTASY APIS)'}
      </Text>
    </Card>
  );
}

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[st.badge, accent && st.badgeOn]}>
      <Text style={[st.badgeT, accent && st.badgeTOn]}>{label}</Text>
    </View>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
    badge: { borderWidth: 1, borderColor: colors.borderBright, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 8 },
    badgeOn: { borderColor: colors.accent },
    badgeT: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textMuted, letterSpacing: 0.8 },
    badgeTOn: { color: colors.accent },
    body: { fontSize: 13, color: colors.textMuted, lineHeight: 19, fontFamily: fonts.body },
    stepsT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1.3, marginTop: 14, marginBottom: 6 },
    step: { fontSize: 13, color: colors.text, lineHeight: 20, fontFamily: fonts.body, marginBottom: 3 },
    links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    link: { borderWidth: 1, borderColor: colors.accent, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
    linkT: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.accent },
    health: { fontFamily: fonts.pixel, fontSize: 7.5, letterSpacing: 0.8, marginTop: 14, lineHeight: 13 },
  })
);
