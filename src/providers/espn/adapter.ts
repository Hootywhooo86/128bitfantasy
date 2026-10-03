import { num, rankByRecord, type League, type Matchup, type Roster, type Slot, type Sport, type Team } from '@/src/sports/models';
import type { Connection, ProviderAdapter } from '../types';
import { espnCookie, espnSeason, fetchEspnLeague, type EspnLeague, type EspnPlayer, type EspnTeam } from './client';

type EspnConn = Extract<Connection, { provider: 'espn' }>;

/**
 * ESPN's numeric codes. Taken from the ids the ESPN site itself uses; an id
 * missing here shows as its number rather than a guess.
 */
const SLOTS: Record<Sport, Record<number, string>> = {
  nfl: { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX' },
  nba: { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'BN', 13: 'IR' },
  nhl: { 0: 'C', 1: 'LW', 2: 'RW', 3: 'F', 4: 'D', 5: 'G', 6: 'UTIL', 7: 'BN', 8: 'IR' },
  mlb: { 0: 'C', 1: '1B', 2: '2B', 3: '3B', 4: 'SS', 5: 'OF', 6: '2B/SS', 7: '1B/3B', 8: 'LF', 9: 'CF', 10: 'RF', 11: 'DH', 12: 'UTIL', 13: 'P', 14: 'SP', 15: 'RP', 16: 'BN', 17: 'IL' },
};

const POSITIONS: Record<Sport, Record<number, string>> = {
  nfl: { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' },
  nba: { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' },
  nhl: { 1: 'C', 2: 'LW', 3: 'RW', 4: 'D', 5: 'G' },
  mlb: { 1: 'SP', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH', 11: 'RP' },
};

const NFL_TEAMS: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN',
  11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
  21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU',
};

function slotKind(label: string | undefined): Slot {
  if (label === 'BN') return 'bench';
  if (label === 'IR' || label === 'IL') return 'ir';
  return 'starter';
}

function teamName(t: EspnTeam): string {
  return t.name?.trim() || [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.abbrev || `Team ${t.id}`;
}

function scoring(raw: EspnLeague, sport: Sport): string | null {
  const type = raw.settings?.scoringSettings?.scoringType;
  if (sport === 'nfl') {
    // Receptions are stat 53.
    const rec = raw.settings?.scoringSettings?.scoringItems?.find((i) => i.statId === 53)?.points;
    if (rec === 1) return 'PPR';
    if (rec === 0.5) return 'Half PPR';
    if (rec != null || type) return rec ? `${rec} PPR` : 'Standard';
  }
  if (!type) return null;
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeSwid(swid: string | null): string | null {
  if (!swid) return null;
  const s = swid.trim().toUpperCase();
  return s.startsWith('{') ? s : `{${s}}`;
}

export function toEspnLeague(raw: EspnLeague, sport: Sport, swid: string | null): League {
  const me = normalizeSwid(swid);
  const mine = me ? raw.teams?.find((t) => t.owners?.some((o) => o.toUpperCase() === me)) : undefined;
  return {
    provider: 'espn',
    id: String(raw.id),
    name: raw.settings?.name ?? `ESPN league ${raw.id}`,
    sport,
    season: String(raw.seasonId),
    teamCount: raw.settings?.size ?? raw.teams?.length ?? null,
    myTeamId: mine ? String(mine.id) : null,
    scoring: scoring(raw, sport),
  };
}

export function toEspnTeams(raw: EspnLeague): Team[] {
  // Owner GUIDs come back in mixed case between members and teams.
  const members = new Map((raw.members ?? []).map((m) => [m.id.toUpperCase(), m]));
  return rankByRecord(
    (raw.teams ?? []).map((t) => {
      const o = t.record?.overall;
      const owner = t.owners?.[0] ? members.get(t.owners[0].toUpperCase()) : undefined;
      return {
        id: String(t.id),
        name: teamName(t),
        owner: owner?.displayName ?? ([owner?.firstName, owner?.lastName].filter(Boolean).join(' ') || null),
        record: o ? { wins: o.wins ?? 0, losses: o.losses ?? 0, ties: o.ties ?? 0 } : null,
        pointsFor: num(o?.pointsFor),
        pointsAgainst: num(o?.pointsAgainst),
        rank: t.rankCalculatedFinal || t.playoffSeed || null,
      };
    })
  );
}

/** Points scored this scoring period (statSourceId 0 = actual). */
export function espnPoints(p: EspnPlayer | undefined, period: number | undefined): number | null {
  if (!p?.stats || period == null) return null;
  const row = p.stats.find((st) => st.statSourceId === 0 && st.statSplitTypeId === 1 && st.scoringPeriodId === period);
  return row?.appliedTotal != null ? Math.round(row.appliedTotal * 100) / 100 : null;
}

/** ESPN's own projection for this scoring period, in the league's scoring. */
export function espnProjection(p: EspnPlayer | undefined, period: number | undefined): number | null {
  if (!p?.stats || period == null) return null;
  const row = p.stats.find((st) => st.statSourceId === 1 && st.statSplitTypeId === 1 && st.scoringPeriodId === period);
  return row?.appliedTotal != null ? Math.round(row.appliedTotal * 10) / 10 : null;
}

export function toEspnRosters(raw: EspnLeague, sport: Sport): Roster[] {
  return (raw.teams ?? []).map((t) => ({
    teamId: String(t.id),
    players: (t.roster?.entries ?? []).map((e) => {
      const p = e.playerPoolEntry?.player;
      const lineupSlot = SLOTS[sport][e.lineupSlotId] ?? String(e.lineupSlotId);
      const injury = e.injuryStatus ?? p?.injuryStatus;
      return {
        id: String(e.playerId),
        name: p?.fullName ?? String(e.playerId),
        position: p ? POSITIONS[sport][p.defaultPositionId] ?? null : null,
        lineupSlot,
        slot: slotKind(lineupSlot),
        proTeam: p && sport === 'nfl' ? NFL_TEAMS[p.proTeamId] ?? null : null,
        injury: injury && injury !== 'ACTIVE' && injury !== 'NORMAL' ? injury.replace(/_/g, ' ') : null,
        projected: espnProjection(p, raw.scoringPeriodId),
        points: espnPoints(p, raw.scoringPeriodId),
      };
    }),
  }));
}

export function toEspnMatchups(raw: EspnLeague): { period: number | null; matchups: Matchup[] } {
  const period = raw.status?.currentMatchupPeriod ?? null;
  if (period == null) return { period: null, matchups: [] };
  const matchups = (raw.schedule ?? [])
    .filter((s) => s.matchupPeriodId === period && s.home)
    .map((s) => ({
      period,
      home: { teamId: String(s.home!.teamId), points: num(s.home!.totalPointsLive ?? s.home!.totalPoints) },
      away: s.away
        ? { teamId: String(s.away.teamId), points: num(s.away.totalPointsLive ?? s.away.totalPoints) }
        : null,
    }));
  return { period, matchups };
}

export const espnAdapter: ProviderAdapter<EspnConn> = {
  id: 'espn',
  label: 'ESPN',
  stability: 'unofficial',
  sports: ['nfl', 'nba', 'mlb', 'nhl'],

  async listLeagues(conn, signal) {
    const cookie = espnCookie(conn.espnS2, conn.swid);
    return Promise.all(
      conn.leagues.map(async ({ id, sport }) =>
        toEspnLeague(await fetchEspnLeague(sport, espnSeason(sport), id, cookie, signal), sport, conn.swid)
      )
    );
  },

  async snapshot(conn, league, signal) {
    const raw = await fetchEspnLeague(league.sport, league.season, league.id, espnCookie(conn.espnS2, conn.swid), signal);
    const { period, matchups } = toEspnMatchups(raw);
    return {
      league: toEspnLeague(raw, league.sport, conn.swid),
      teams: toEspnTeams(raw),
      rosters: toEspnRosters(raw, league.sport),
      matchups,
      period,
      fetchedAt: Date.now(),
    };
  },
};
