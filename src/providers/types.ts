import type { League, LeagueSnapshot, ProviderId, Sport } from '@/src/sports/models';

/**
 * What a user typed or authorised to connect one provider account.
 *
 * Secrets in here (tokens, cookies) live in the device keystore — see
 * lib/storage/connections.ts. Never in the repo, never in plain settings.
 */
export type Connection =
  | { provider: 'sleeper'; username: string }
  | {
      provider: 'yahoo';
      clientId: string;
      clientSecret: string;
      accessToken: string;
      refreshToken: string;
      /** epoch ms */
      expiresAt: number;
    }
  | {
      provider: 'fantrax';
      /** The read-only "User Secret ID" from Fantrax → User Profile. Optional. */
      userSecretId: string | null;
      /** League ids added by hand, for when getLeagues comes back empty. */
      leagueIds: string[];
    }
  | {
      provider: 'espn';
      leagues: { id: string; sport: Sport }[];
      /** Private leagues only. */
      espnS2: string | null;
      swid: string | null;
    }
  | { provider: 'fleaflicker'; email: string; sport: Sport[] }
  | {
      /** 128BIT LEAGUES: the league's Supabase project. The key is the public (anon) one. */
      provider: 'bit128';
      url: string;
      anonKey: string;
    }
  | {
      provider: 'mfl';
      /** League id, plus your franchise id ("0004") if you know it. */
      leagues: { id: string; franchiseId: string | null }[];
    };

/** Thrown with a sentence the user can act on. */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;
  constructor(provider: ProviderId, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

export type ProviderAdapter<C extends Connection = Connection> = {
  id: ProviderId;
  label: string;
  /** One honest line on how solid this integration is. */
  stability: 'official' | 'unofficial' | 'experimental';
  sports: Sport[];
  listLeagues(conn: C, signal?: AbortSignal): Promise<League[]>;
  snapshot(conn: C, league: League, signal?: AbortSignal): Promise<LeagueSnapshot>;
};
