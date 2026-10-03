import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Label, MenuRow, Note, Screen } from '@/components/ui';
import { getConnections } from '@/lib/storage/connections';
import { ADAPTERS, PROVIDER_ORDER } from '@/src/providers/registry';
import type { Connection } from '@/src/providers/types';
import { cachedLeagues } from '@/src/sports/hub';
import type { League, ProviderId } from '@/src/sports/models';

const HOW: Record<ProviderId, string> = {
  sleeper: 'Username only, no password.',
  yahoo: 'Sign in with Yahoo. Uses your own free Yahoo developer app.',
  espn: 'League ID. Private leagues also need two browser cookies.',
  fantrax: 'Publicly viewable leagues only.',
  fleaflicker: 'Your Fleaflicker email, no password.',
};

const STABILITY = { official: 'OFFICIAL API', unofficial: 'UNOFFICIAL', experimental: 'EXPERIMENTAL' } as const;

export default function Leagues() {
  const router = useRouter();
  const [conns, setConns] = useState<Connection[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);

  useFocusEffect(
    useCallback(() => {
      getConnections().then(setConns);
      cachedLeagues().then(setLeagues);
    }, [])
  );

  const connected = new Set(conns.map((c) => c.provider));

  return (
    <Screen section="Leagues">
      <Label>PROVIDERS</Label>
      {PROVIDER_ORDER.map((p) => {
        const a = ADAPTERS[p];
        const n = leagues.filter((l) => l.provider === p).length;
        return (
          <MenuRow
            key={p}
            icon={connected.has(p) ? '●' : '○'}
            name={a.label}
            sub={`${STABILITY[a.stability]} · ${HOW[p]}`}
            value={connected.has(p) ? `${n} league${n === 1 ? '' : 's'}` : 'Connect'}
            onPress={() => router.push({ pathname: '/connect/[provider]', params: { provider: p } })}
          />
        );
      })}
      <Note>
        Read-only everywhere: 128BIT FANTASY never changes a lineup or makes a move for you. Logins, tokens and cookies
        stay in this phone&apos;s keystore.
      </Note>
    </Screen>
  );
}
