/**
 * What the user needs to know about each provider before signing in: how it
 * connects, what its API can do, what this app does with it, and where to go
 * when it goes wrong.
 *
 * Links were checked to load on 2026-10-03. The API watch (health.ts and the
 * daily CI job) is what notices when a provider changes underneath us.
 */
import type { ProviderId } from '@/src/sports/models';

export type Access = 'read-write' | 'read-only';

export type HelpLink = { label: string; url: string };

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** What the provider's own API allows. */
  apiAccess: Access;
  /** What 128BIT FANTASY does with it. Always read-only today. */
  appAccess: Access;
  official: boolean;
  connectWith: string;
  /** One line on what reading/writing means here. */
  accessNote: string;
  steps: string[];
  help: HelpLink[];
};

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  sleeper: {
    id: 'sleeper',
    label: 'Sleeper',
    apiAccess: 'read-only',
    appAccess: 'read-only',
    official: true,
    connectWith: 'Username',
    accessNote: "Sleeper's public API is read-only. Lineup changes happen in the Sleeper app.",
    steps: ['Open Sleeper → tap your avatar → your username is under your name.', 'Type it here. No password.'],
    help: [
      { label: 'Sleeper API docs', url: 'https://docs.sleeper.com' },
      { label: 'Sleeper support', url: 'https://support.sleeper.com' },
    ],
  },
  yahoo: {
    id: 'yahoo',
    label: 'Yahoo',
    apiAccess: 'read-write',
    appAccess: 'read-only',
    official: true,
    connectWith: 'Yahoo sign-in (your own Yahoo app keys)',
    accessNote:
      "Yahoo's API can set lineups and make moves, but this app only asks for read access and never changes anything.",
    steps: [
      'Open Create App below and sign in to Yahoo.',
      'Application type: Installed Application. Redirect URI: oob. API permissions: Fantasy Sports → Read.',
      'Copy the Client ID and Client Secret here.',
      'Tap SIGN IN WITH YAHOO, approve, and paste the code Yahoo shows you.',
    ],
    help: [
      { label: 'Create a Yahoo app', url: 'https://developer.yahoo.com/apps/create/' },
      { label: 'Yahoo Fantasy API guide', url: 'https://developer.yahoo.com/fantasysports/guide/' },
      { label: 'Yahoo Fantasy help', url: 'https://help.yahoo.com/kb/fantasy-sports' },
    ],
  },
  espn: {
    id: 'espn',
    label: 'ESPN',
    apiAccess: 'read-write',
    appAccess: 'read-only',
    official: false,
    connectWith: 'League ID (+ two cookies for private leagues)',
    accessNote:
      "ESPN has no public API. Its site can write with your login cookies, but this app only reads — it never moves a player.",
    steps: [
      'Open your league on espn.com. The number after leagueId= in the address is the League ID.',
      'Private league? On a computer, sign in to espn.com → DevTools (F12) → Application → Cookies → espn.com.',
      'Copy espn_s2 and SWID here. SWID also tells us which team is yours.',
    ],
    help: [
      { label: 'ESPN Fantasy', url: 'https://www.espn.com/fantasy/' },
      { label: 'ESPN Fan Support', url: 'https://support.espn.com/hc/en-us' },
    ],
  },
  fantrax: {
    id: 'fantrax',
    label: 'Fantrax',
    apiAccess: 'read-only',
    appAccess: 'read-only',
    official: false,
    connectWith: 'League ID and/or User Secret ID',
    accessNote:
      'Fantrax has no official API. This uses its read-only public feed: publicly viewable leagues only, and no live scores.',
    steps: [
      'Open the league on fantrax.com. The League ID is the part after /league/ in the address.',
      'Commissioner: League → Settings → make the league publicly viewable, or the feed returns nothing.',
      'Optional: Fantrax → User Profile → User Secret ID lists your leagues automatically.',
    ],
    help: [
      { label: 'Fantrax support', url: 'https://www.fantrax.com/support' },
      { label: 'Fantrax help pages', url: 'https://www.fantrax.com/newui/fantasy/help.go' },
    ],
  },
  fleaflicker: {
    id: 'fleaflicker',
    label: 'Fleaflicker',
    apiAccess: 'read-only',
    appAccess: 'read-only',
    official: true,
    connectWith: 'Email',
    accessNote: "Fleaflicker's public API is read-only. Make moves on fleaflicker.com.",
    steps: ['Type the email address on your Fleaflicker account. No password.'],
    help: [
      { label: 'Fleaflicker API docs', url: 'https://www.fleaflicker.com/api-docs/index.html' },
      { label: 'Fleaflicker help forum', url: 'https://www.fleaflicker.com/forums/help' },
    ],
  },
};

export function accessLabel(a: Access): string {
  return a === 'read-write' ? 'READ & WRITE' : 'READ ONLY';
}
