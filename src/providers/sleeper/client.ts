/**
 * Sleeper — official, public, read-only REST. No auth.
 * Docs: https://docs.sleeper.com  ·  ~1000 calls/min per IP.
 *
 * Raw shapes only. Normalising happens in adapter.ts.
 */
import { getJson } from '../http';

export const SLEEPER_BASE = 'https://api.sleeper.app/v1';

export type SleeperSport = 'nfl' | 'nba';

export type SleeperUser = { user_id: string; username?: string; display_name: string };

export type SleeperState = {
  week: number;
  display_week?: number;
  season: string;
  /** The season new leagues are being created in — what the user's league list is keyed by. */
  league_season?: string;
  season_type: 'pre' | 'regular' | 'post' | 'off' | string;
};

export type SleeperLeague = {
  league_id: string;
  name: string;
  sport: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: Record<string, unknown>;
};

export type SleeperLeagueUser = {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    rank?: number;
  };
};

export type SleeperMatchup = {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  /** Every rostered player's points this week, bench included. */
  players_points?: Record<string, number> | null;
};

export type SleeperPlayer = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  practice_participation?: string | null;
  espn_id?: string | number | null;
};

export type SleeperPlayers = Record<string, SleeperPlayer>;

type Opts = { signal?: AbortSignal };

const enc = encodeURIComponent;

export const sleeper = {
  user: (username: string, o: Opts = {}) =>
    getJson<SleeperUser>('sleeper', `${SLEEPER_BASE}/user/${enc(username.trim())}`, { ...o, label: 'Sleeper user' }),
  state: (sport: SleeperSport, o: Opts = {}) =>
    getJson<SleeperState>('sleeper', `${SLEEPER_BASE}/state/${sport}`, o),
  leagues: (userId: string, sport: SleeperSport, season: string, o: Opts = {}) =>
    getJson<SleeperLeague[]>('sleeper', `${SLEEPER_BASE}/user/${enc(userId)}/leagues/${sport}/${enc(season)}`, o),
  /** Carries roster_positions, which the user's league list does not always include. */
  league: (leagueId: string, o: Opts = {}) =>
    getJson<SleeperLeague>('sleeper', `${SLEEPER_BASE}/league/${enc(leagueId)}`, o),
  users: (leagueId: string, o: Opts = {}) =>
    getJson<SleeperLeagueUser[]>('sleeper', `${SLEEPER_BASE}/league/${enc(leagueId)}/users`, o),
  rosters: (leagueId: string, o: Opts = {}) =>
    getJson<SleeperRoster[]>('sleeper', `${SLEEPER_BASE}/league/${enc(leagueId)}/rosters`, o),
  matchups: (leagueId: string, week: number, o: Opts = {}) =>
    getJson<SleeperMatchup[]>('sleeper', `${SLEEPER_BASE}/league/${enc(leagueId)}/matchups/${week}`, o),
  /** ~14 MB. Cache it — see lib/storage/player-cache.ts. */
  players: (sport: SleeperSport, o: Opts = {}) =>
    getJson<SleeperPlayers>('sleeper', `${SLEEPER_BASE}/players/${sport}`, {
      ...o,
      label: 'Sleeper player catalog',
      timeoutMs: 90_000,
    }),
};
