/**
 * 128BIT LEAGUES — leagues hosted by this app, stored in the user's own
 * Supabase project. These are the shapes the engine works on; the database
 * rows (supabase/schema.sql) map onto them one to one.
 */
import type { HostedSport, ScoringRules, StatLine } from './scoring';

/** Lineup slot → how many of them. Order is the order the lineup shows. */
export type RosterSlots = Record<string, number>;

export const NHL_SLOTS: RosterSlots = { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2 };
export const NFL_SLOTS: RosterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };

export const DEFAULT_SLOTS: Record<HostedSport, RosterSlots> = { nhl: NHL_SLOTS, nfl: NFL_SLOTS };
export const DEFAULT_BENCH: Record<HostedSport, number> = { nhl: 4, nfl: 6 };

/** Which player positions each slot takes. A slot not listed takes its own position only. */
export const SLOT_ACCEPTS: Record<string, string[]> = {
  UTIL: ['C', 'LW', 'RW', 'D'],
  F: ['C', 'LW', 'RW'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  BN: ['*'],
  IR: ['*'],
};

export type LeagueSettings = {
  slots: RosterSlots;
  bench: number;
  scoring: ScoringRules;
  /** Seconds per pick before auto-pick may run. */
  pickSeconds: number;
  /** Regular-season matchup weeks. */
  weeks: number;
};

export type LeagueStatus = 'setup' | 'drafting' | 'season' | 'done';

export type HostedLeague = {
  id: string;
  name: string;
  sport: HostedSport;
  /** "2026" for NFL; "20262027" for NHL, as the NHL numbers it. */
  season: string;
  /** Short code friends type to join. */
  inviteCode: string;
  commissioner: string;
  maxTeams: number;
  status: LeagueStatus;
  settings: LeagueSettings;
  /** Draft order once set, by team id. */
  draftOrder: string[];
  createdAt: string;
};

export type HostedTeam = { id: string; leagueId: string; owner: string; name: string };

export type DraftPick = { leagueId: string; pickNo: number; teamId: string; playerId: string; madeAt: string; auto: boolean };

/** One player on one team. `slot` is a lineup slot, "BN" or "IR". */
export type RosterEntry = { leagueId: string; teamId: string; playerId: string; slot: string };

export type HostedMatchup = { leagueId: string; week: number; home: string; away: string | null };

/** A player anyone can draft or pick up. */
export type PoolPlayer = {
  id: string;
  name: string;
  /** Fantasy position: C, LW, RW, D, G / QB, RB, WR, TE, K, DEF. */
  position: string;
  /** Current pro team abbreviation, or null for a free agent. */
  team: string | null;
  /** Last season's totals; scored with the league's rules, it is the draft ranking. */
  seasonLine: StatLine;
  gamesPlayed: number;
};
