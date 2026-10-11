import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Empty, Note, Screen } from '@/components/ui';
import { signInFromLink } from '@/lib/leagues/client';

/**
 * bitfantasy://auth — where the emailed sign-in link lands once Supabase has
 * checked it. The session rides in the address (#access_token=…), so this
 * screen hands it to Supabase and goes on to 128BIT LEAGUES.
 */
export default function AuthReturn() {
  const url = Linking.useURL();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    signInFromLink(url)
      .then((ok) => {
        if (ok) router.replace('/hosted');
        else setError('That link had no sign-in in it. Go back and tap EMAIL ME A CODE for a new one.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [url, router]);

  return (
    <Screen section="128bit Leagues" back>
      {error ? <Note tone="error">{error}</Note> : <Empty title="SIGNING IN" body="Finishing your sign-in…" />}
    </Screen>
  );
}
