import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, CardHead, Field, Label, Note, Screen } from '@/components/ui';
import {
  deleteFamilyAccount,
  familyEmail,
  flushFamily,
  onFamily,
  signInEmail,
  signInWith,
  signOutFamily,
  signUpEmail,
} from '@/lib/family';

/** Settings → 128bit family account: one sign-in across every 128bit app. */
export default function FamilyAccountScreen() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [mail, setMail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    const load = () => void familyEmail().then(setEmail);
    load();
    return onFamily(load);
  }, []);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen section="128bit family" back right="none">
      <Note>
        One sign-in for 128bitPlay, 128bitfit, 128bit Tracker and every 128bit app. Signed in, your wins,
        losses, ties and lineup fixes show on Tracker&apos;s timeline and earn XP in 128bitlife. Rosters,
        scores and league logins stay on this phone. This is separate from a 128BIT LEAGUES server&apos;s sign-in.
      </Note>
      {email === undefined ? null : email ? (
        <Card>
          <CardHead title="SIGNED IN" note={email} />
          <Button label="Send now" kind="ghost" busy={busy} onPress={() => run(async () => { await flushFamily(); return 'Sent.'; })} />
          <Button label="Sign out" kind="ghost" disabled={busy} onPress={() => run(signOutFamily)} />
          <Button
            label="Delete 128bit family account"
            kind="danger"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Delete your 128bit family account?',
                'Everything every 128bit app sent to it is deleted for good. Your leagues and this phone’s data stay.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => run(async () => { await deleteFamilyAccount(); return 'Account deleted.'; }) },
                ],
              )
            }
          />
        </Card>
      ) : (
        <>
          <Button label="Continue with Google" busy={busy} onPress={() => run(() => signInWith('google'))} />
          <Button label="Continue with Apple" kind="ghost" disabled={busy} onPress={() => run(() => signInWith('apple'))} />
          <Label>OR WITH EMAIL</Label>
          <Field label="EMAIL" value={mail} onChangeText={setMail} keyboardType="email-address" autoComplete="email" />
          <Field label="PASSWORD" value={pass} onChangeText={setPass} secureTextEntry autoComplete="password" />
          <Button
            label="Sign in"
            kind="ghost"
            disabled={busy || !mail || !pass}
            onPress={() => run(async () => { await signInEmail(mail, pass); setPass(''); })}
          />
          <Button
            label="Create account"
            kind="ghost"
            disabled={busy || !mail || pass.length < 6}
            onPress={() => run(async () => ((await signUpEmail(mail, pass)) ? undefined : 'Check your email for the confirmation link, then sign in.'))}
          />
        </>
      )}
      {msg ? <Note tone={msg.bad ? 'error' : 'muted'}>{msg.text}</Note> : null}
    </Screen>
  );
}
