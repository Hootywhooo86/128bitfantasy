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
      'Redirect URI: oob. API permissions: tick Fantasy Sports → Read (or Read/Write) — without it sign-in works but leagues are refused. Public or Confidential both work.',
      'Copy the Client ID here. Confidential app: also the Client Secret. Public app: leave the secret empty.',
      'Tap SIGN IN WITH YAHOO, approve, and paste the code Yahoo shows you. Stuck? RUN YAHOO CHECK shows which step fails.',
    ],
    help: [
      { label: 'Create a Yahoo app', url: 'https://developer.yahoo.com/apps/create/' },
      { label: 'Yahoo Fantasy API guide', url: 'https://sports.yahoo.com/developer/docs/' },
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
  mfl: {
    id: 'mfl',
    label: 'MyFantasyLeague',
    apiAccess: 'read-write',
    appAccess: 'read-only',
    official: true,
    connectWith: 'League ID (+ your franchise number)',
    accessNote:
      "MFL's official API can submit lineups and moves with a login. This app only uses its public read side — no password, never changes anything.",
    steps: [
      'Open your league on myfantasyleague.com. The League ID is the number after /home/ in the address.',
      'Optional: your franchise number (0001, 0002…) is in the address of your team page as F=. Without it, pick your team in My Teams.',
      'Private leagues (that hide from non-members) cannot be read.',
    ],
    help: [
      { label: 'MFL API reference', url: 'https://api.myfantasyleague.com/2026/api_info' },
      { label: 'MyFantasyLeague home', url: 'https://www.myfantasyleague.com/' },
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
