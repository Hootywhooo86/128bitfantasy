/**
 * The normalized shapes every screen reads.
 *
 * Providers fetch. Sports normalize. Nothing provider-shaped gets past
 * src/providers/<name>/adapter.ts — a Sleeper roster_id or a Yahoo team_key
 * travels only as an opaque `id` string.
 *
 * Absent and zero are different things. A team with no points yet has
 * `pointsFor: 0`; a provider that does not report points gives `null`, and the
 * UI shows a dash, not a 0.
 */

export type Sport = 'nfl' | 'nba' | 'mlb' | 'nhl';

export const SPORTS: { id: Sport; label: string }[] = [
  { id: 'nfl', label: 'NFL' },
  { id: 'nba', label: 'NBA' },
  { id: 'mlb', label: 'MLB' },
  { id: 'nhl', label: 'NHL' },
];

export type ProviderId = 'sleeper' | 'yahoo' | 'fantrax' | 'espn' | 'fleaflicker';

export type Record3 = { wins: number; losses: number; ties: number };

export type League = {
  provider: ProviderId;
  /** Provider's league id, opaque. */
  id: string;
  name: string;
  sport: Sport;
  season: string;
  teamCount: number | null;
  /** The connected user's team in this league, when the provider says which. */
  myTeamId: string | null;
  /** "PPR", "Half PPR", "H2H Categories"… — whatever the provider tells us. */
  scoring: string | null;
};

export type Team = {
  id: string;
  name: string;
  owner: string | null;
  record: Record3 | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  /** 1 = first. Null when the provider has no standings yet. */
  rank: number | null;
};

export type Slot = 'starter' | 'bench' | 'ir' | 'taxi';

export type RosterPlayer = {
  id: string;
  name: string;
  /** Primary position, e.g. "WR", "C", "SP". */
  position: string | null;
  /** The lineup slot the player is in, e.g. "FLEX", "UTIL", "BN". */
  lineupSlot: string | null;
  slot: Slot;
  /** Pro team abbreviation as the provider reports it. */
  proTeam: string | null;
  /** "Questionable", "Out", "IR"… or null when healthy / unknown. */
  injury: string | null;
};

export type Roster = { teamId: string; players: RosterPlayer[] };

export type MatchupSide = { teamId: string; points: number | null };

export type Matchup = {
  /** Week, matchup period or scoring period, as the provider numbers it. */
  period: number;
  home: MatchupSide;
  away: MatchupSide | null;
};

/** Everything one league screen needs, fetched together. */
export type LeagueSnapshot = {
  league: League;
  teams: Team[];
  rosters: Roster[];
  matchups: Matchup[];
  /** The period `matchups` belongs to, or null if the provider has none yet. */
  period: number | null;
  fetchedAt: number;
};

export function emptyRecord(): Record3 {
  return { wins: 0, losses: 0, ties: 0 };
}

export function formatRecord(r: Record3 | null): string {
  if (!r) return '—';
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** A team's matchup this period, if the game is known. */
export function matchupFor(s: LeagueSnapshot, teamId: string | null): Matchup | null {
  if (!teamId) return null;
  return s.matchups.find((m) => m.home.teamId === teamId || m.away?.teamId === teamId) ?? null;
}

/** The connected user's matchup this period, if both the team and the game are known. */
export function myMatchup(s: LeagueSnapshot): Matchup | null {
  return matchupFor(s, s.league.myTeamId);
}

/**
 * Signs a provider changed its API under us: data came back but the parts we
 * read are empty. Shown as a note so blank screens are never a mystery.
 */
export function snapshotProblems(s: LeagueSnapshot): string[] {
  const out: string[] = [];
  if (s.teams.length === 0) out.push('no teams came back');
  else if (s.rosters.length > 0 && s.rosters.every((r) => r.players.length === 0)) out.push('every roster came back empty');
  else if (s.rosters.some((r) => r.players.length > 0 && r.players.every((p) => p.name === p.id))) {
    out.push('player names are missing');
  }
  return out;
}

/** Orders a matchup so the user's side comes first. */
export function sides(m: Matchup, myTeamId: string | null): [MatchupSide, MatchupSide | null] {
  if (m.away && m.away.teamId === myTeamId) return [m.away, m.home];
  return [m.home, m.away];
}

/** Numbers from APIs arrive as numbers, numeric strings, or nothing. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Fills rank from record then points when the provider gave none. */
export function rankByRecord(teams: Team[]): Team[] {
  if (teams.every((t) => t.rank != null)) return teams;
  const sorted = [...teams].sort((a, b) => {
    const wa = (a.record?.wins ?? 0) + (a.record?.ties ?? 0) / 2;
    const wb = (b.record?.wins ?? 0) + (b.record?.ties ?? 0) / 2;
    return wb - wa || (b.pointsFor ?? 0) - (a.pointsFor ?? 0);
  });
  // Some teams ranked and some not is not a standings table — rank them all.
  return sorted.map((t, i) => ({ ...t, rank: i + 1 }));
}
