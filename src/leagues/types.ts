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
/** Yahoo's default baseball lineup. */
export const MLB_SLOTS: RosterSlots = { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 2, SP: 2, RP: 2, P: 4 };
/** Yahoo's default basketball lineup. */
export const NBA_SLOTS: RosterSlots = { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2 };

export const DEFAULT_SLOTS: Record<HostedSport, RosterSlots> = { nhl: NHL_SLOTS, nfl: NFL_SLOTS, mlb: MLB_SLOTS, nba: NBA_SLOTS };
export const DEFAULT_BENCH: Record<HostedSport, number> = { nhl: 4, nfl: 6, mlb: 5, nba: 3 };

/** Flexible slots and what they take, per sport. Any slot not listed takes its own position only. */
const FLEX_SLOTS: Record<HostedSport, Record<string, string[] | '*'>> = {
  nhl: { UTIL: ['C', 'LW', 'RW', 'D'], F: ['C', 'LW', 'RW'] },
  nfl: { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] },
  mlb: { UTIL: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'], CI: ['1B', '3B'], MI: ['2B', 'SS'], P: ['SP', 'RP'] },
  nba: { UTIL: '*', G: ['PG', 'SG'], F: ['SF', 'PF'] },
};

export function isFlexSlot(slot: string, sport: HostedSport): boolean {
  return slot in FLEX_SLOTS[sport];
}

/**
 * Whether a lineup slot takes a player. Players can list several positions
 * ("SF/PF"); any one that fits will do. Matches slot_takes in schema.sql.
 */
export function slotTakes(slot: string, position: string, sport: HostedSport = 'nhl'): boolean {
  if (slot === 'BN' || slot === 'IR') return true;
  const flex = FLEX_SLOTS[sport][slot];
  return position.split('/').some((p) => p === slot || flex === '*' || (Array.isArray(flex) && flex.includes(p)));
}

/**
 * How a league decides who's winning.
 * - h2h_points: weekly matchups, more fantasy points wins.
 * - h2h_cats: weekly matchups, each category is a win/loss/tie (Yahoo style).
 * - h2h_most_cats: weekly matchups, whoever wins more categories gets the W.
 * - points: no matchups, most fantasy points over the season wins.
 * - roto: no matchups, season totals ranked per category, ranks added up.
 */
export type LeagueFormat = 'h2h_points' | 'h2h_cats' | 'h2h_most_cats' | 'points' | 'roto';

export const FORMAT_LABELS: Record<LeagueFormat, string> = {
  h2h_points: 'Head-to-head points',
  h2h_cats: 'Head-to-head categories',
  h2h_most_cats: 'Head-to-head most categories',
  points: 'Total points (season)',
  roto: 'Rotisserie',
};

export const FORMAT_NOTES: Record<LeagueFormat, string> = {
  h2h_points: 'Play one team a week. More fantasy points wins the week.',
  h2h_cats: 'Play one team a week. Every category counts as its own win, loss or tie.',
  h2h_most_cats: 'Play one team a week. Win more categories than them, get the W.',
  points: 'No matchups. Most fantasy points over the whole season wins.',
  roto: 'No matchups. Season totals ranked in each category; best total rank wins.',
};

export const isH2H = (f: LeagueFormat) => f === 'h2h_points' || f === 'h2h_cats' || f === 'h2h_most_cats';
export const usesCategories = (f: LeagueFormat) => f === 'h2h_cats' || f === 'h2h_most_cats' || f === 'roto';

export type WaiverType = 'rolling' | 'faab' | 'none';
export type TradeReview = 'none' | 'commissioner' | 'vote';
export type DraftType = 'snake' | 'linear' | 'auction';

export type LeagueSettings = {
  format: LeagueFormat;
  slots: RosterSlots;
  bench: number;
  /** Injured-reserve spots, on top of the roster. */
  ir: number;
  scoring: ScoringRules;
  /** Category keys (see categories.ts), for category and roto formats. */
  categories: string[];
  draftType: DraftType;
  /** Seconds per pick before auto-pick may run. */
  pickSeconds: number;
  /** Regular-season matchup weeks. */
  weeks: number;
  /** Teams in the playoffs (0 = none). Playoff weeks follow the regular season. */
  playoffTeams: number;
  waivers: {
    type: WaiverType;
    /** Days a dropped player sits on waivers before anyone can just add him. */
    days: number;
    /** FAAB budget per team. */
    budget: number;
  };
  trades: {
    review: TradeReview;
    /** Hours other teams / the commissioner have to object before it goes through. */
    reviewHours: number;
    /** Votes against that kill a trade, in vote mode. */
    vetoVotes: number;
    /** No trades after this date (YYYY-MM-DD), or null. */
    deadline: string | null;
  };
  /** Adds per team in any 7 days (0 = unlimited). */
  maxAddsPerWeek: number;
  /** Division names; empty = no divisions. Division winners get the top playoff seeds. */
  divisions: string[];
  /** Players each team may keep into next season (0 = redraft; the whole roster = dynasty). */
  keepers: number;
  /** Rounds in drafts after the first season; null = roster size minus keepers. */
  draftRounds: number | null;
  /** Auction drafts: each team's budget, and seconds a bid stays open. */
  auctionBudget: number;
  bidSeconds: number;
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

export type HostedTeam = { id: string; leagueId: string; owner: string; name: string; division?: number | null };

export type DraftPick = { leagueId: string; pickNo: number; teamId: string; playerId: string; madeAt: string; auto: boolean; price?: number | null };

/** One player on one team. `slot` is a lineup slot, "BN" or "IR". */
export type RosterEntry = { leagueId: string; teamId: string; playerId: string; slot: string };

export type HostedMatchup = { leagueId: string; week: number; home: string; away: string | null };

/** A player anyone can draft or pick up. */
export type PoolPlayer = {
  id: string;
  name: string;
  /** Fantasy position(s): C, LW, RW, D, G / QB, RB, WR, TE, K, DEF / C, 1B, 2B, 3B, SS, OF, DH, SP, RP / PG, SG, SF, PF, C. Several as "SF/PF". */
  position: string;
  /** Current pro team abbreviation, or null for a free agent. */
  team: string | null;
  /** Last season's totals; scored with the league's rules, it is the draft ranking. */
  seasonLine: StatLine;
  gamesPlayed: number;
};
