/**
 * ESPN — unofficial. The v3 JSON the ESPN site itself reads.
 *
 * Public leagues need nothing. Private leagues need the `espn_s2` and `SWID`
 * cookies from a signed-in browser session. There is no "list my leagues"
 * without ESPN's fan API, so leagues are added by id.
 *
 * Host: lm-api-reads.fantasy.espn.com — the old fantasy.espn.com v3 host stopped
 * returning JSON reliably. Undocumented, so expect it to move again.
 */
import type { Sport } from '@/src/sports/models';
import { getJson } from '../http';

export const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games';

export const ESPN_GAME: Record<Sport, string> = { nfl: 'ffl', nba: 'fba', mlb: 'flb', nhl: 'fhl' };

export type EspnPlayer = {
  id: number;
  fullName: string;
  defaultPositionId: number;
  proTeamId: number;
  injuryStatus?: string;
  injured?: boolean;
  /** Lineup slot ids this player may fill. */
  eligibleSlots?: number[];
  /** statSourceId 1 = projected, statSplitTypeId 1 = one scoring period. */
  stats?: { statSourceId?: number; statSplitTypeId?: number; scoringPeriodId?: number; appliedTotal?: number }[];
};

export type EspnRosterEntry = {
  playerId: number;
  lineupSlotId: number;
  injuryStatus?: string;
  playerPoolEntry?: { player?: EspnPlayer };
};

export type EspnTeam = {
  id: number;
  /** Newer leagues. Older ones split it into location + nickname. */
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  owners?: string[];
  playoffSeed?: number;
  rankCalculatedFinal?: number;
  record?: {
    overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number };
  };
  roster?: { entries?: EspnRosterEntry[] };
};

export type EspnMember = { id: string; displayName?: string; firstName?: string; lastName?: string };

export type EspnScheduleItem = {
  id: number;
  matchupPeriodId: number;
  home?: { teamId: number; totalPoints?: number; totalPointsLive?: number };
  away?: { teamId: number; totalPoints?: number; totalPointsLive?: number };
};

export type EspnLeague = {
  id: number;
  seasonId: number;
  scoringPeriodId?: number;
  status?: { currentMatchupPeriod?: number; isActive?: boolean };
  settings?: {
    name?: string;
    size?: number;
    scoringSettings?: { scoringType?: string; scoringItems?: { statId: number; points?: number }[] };
  };
  members?: EspnMember[];
  teams?: EspnTeam[];
  schedule?: EspnScheduleItem[];
};

/**
 * ESPN names a season by the year it ends: the 2026-27 NBA season is 2027.
 * The NFL season belongs to the year it kicks off, so January playoffs are
 * still the previous season.
 */
export function espnSeason(sport: Sport, now = new Date()): number {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0 = Jan
  if (sport === 'nfl') return m < 2 ? y - 1 : y;
  if (sport === 'mlb') return y;
  return m >= 8 ? y + 1 : y;
}

export function espnCookie(espnS2: string | null, swid: string | null): string | null {
  if (!espnS2 || !swid) return null;
  const id = swid.trim().startsWith('{') ? swid.trim() : `{${swid.trim()}}`;
  return `espn_s2=${espnS2.trim()}; SWID=${id}`;
}

export function espnLeagueUrl(sport: Sport, season: number | string, leagueId: string): string {
  const views = ['mSettings', 'mTeam', 'mRoster', 'mMatchupScore', 'mStandings'];
  return (
    `${ESPN_BASE}/${ESPN_GAME[sport]}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}?` +
    views.map((v) => `view=${v}`).join('&')
  );
}

export function fetchEspnLeague(
  sport: Sport,
  season: number | string,
  leagueId: string,
  cookie: string | null,
  signal?: AbortSignal
): Promise<EspnLeague> {
  return getJson<EspnLeague>('espn', espnLeagueUrl(sport, season, leagueId), {
    signal,
    label: 'ESPN league',
    headers: cookie ? { Cookie: cookie } : {},
  });
}
