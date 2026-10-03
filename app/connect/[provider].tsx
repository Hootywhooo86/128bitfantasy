import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, CardHead, Chips, Field, Label, Note, Screen, s as ui } from '@/components/ui';
import { describeNetworkFailure } from '@/lib/net-errors';
import { getConnection, removeConnection, saveConnection } from '@/lib/storage/connections';
import { providerLabel } from '@/src/providers/http';
import type { Connection } from '@/src/providers/types';
import { exchangeYahooCode, yahooAuthorizeUrl } from '@/src/providers/yahoo/oauth';
import { syncLeagues } from '@/src/sports/hub';
import { SPORTS, type ProviderId, type Sport } from '@/src/sports/models';

const splitIds = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export default function Connect() {
  const { provider } = useLocalSearchParams<{ provider: ProviderId }>();
  const router = useRouter();
  const [existing, setExisting] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    sport: 'nfl' as Sport,
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    getConnection(provider).then((c) => {
      setExisting(c);
      if (!c) return;
      if (c.provider === 'sleeper') setF((x) => ({ ...x, username: c.username }));
      if (c.provider === 'fleaflicker') setF((x) => ({ ...x, email: c.email }));
      if (c.provider === 'yahoo') setF((x) => ({ ...x, clientId: c.clientId, clientSecret: c.clientSecret }));
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
      case 'fantrax': {
        const ids = splitIds(f.leagueIds);
        if (!ids.length && !f.userSecretId.trim()) throw new Error('Enter a league ID or your User Secret ID.');
        return { provider, userSecretId: f.userSecretId.trim() || null, leagueIds: ids };
      }
      case 'yahoo': {
        if (!f.clientId.trim() || !f.clientSecret.trim()) throw new Error('Enter your Yahoo app Client ID and Client Secret first.');
        if (!f.code.trim()) throw new Error('Tap SIGN IN WITH YAHOO, approve, then paste the code Yahoo shows you.');
        const t = await exchangeYahooCode(f.clientId, f.clientSecret, f.code);
        return { provider, clientId: f.clientId.trim(), clientSecret: f.clientSecret.trim(), ...t };
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
    <Screen section={`Connect ${providerLabel(provider)}`} back right="none">
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
          <Note>
            Fantrax has no official API. This uses its read-only public feed, which only works for leagues the commissioner
            has made publicly viewable, and has no live scores. It may break without warning.
          </Note>
        </Card>
      )}

      {provider === 'yahoo' && (
        <Card>
          <CardHead title="YAHOO" note="Official API · OAuth" />
          <Note>
            Yahoo needs an app to sign in through. Create one free at developer.yahoo.com → My Apps → Create App, with
            Redirect URI “oob” and API permission Fantasy Sports: Read. Paste its keys here — they stay on this phone, like
            your AI key.
          </Note>
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
      <Button label={existing ? 'SAVE & SYNC' : 'CONNECT'} onPress={save} busy={busy} />
      {existing ? <Button label="DISCONNECT" kind="danger" onPress={disconnect} /> : null}
      <Text style={[ui.fieldH, { marginTop: 14 }]}>
        Read-only: nothing here can change your lineup or make a move.
      </Text>
    </Screen>
  );
}
