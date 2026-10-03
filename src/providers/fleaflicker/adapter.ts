/**
 * Fleaflicker — official, public, read-only. No auth.
 * Docs: https://www.fleaflicker.com/api-docs/index.html
 *
 * The docs list fields in snake_case; the JSON arrives in camelCase. Both are
 * read, so a change in either direction does not blank the screen.
 */
import { num, rankByRecord, type League, type Matchup, type Roster, type RosterPlayer, type Slot, type Sport, type Team } from '@/src/sports/models';
import { getJson } from '../http';
import type { Connection, ProviderAdapter } from '../types';

type FleaConn = Extract<Connection, { provider: 'fleaflicker' }>;

export const FLEA_BASE = 'https://www.fleaflicker.com/api';

type Obj = Record<string, unknown>;

/** Reads `camelCase` or `snake_case`, whichever the response used. */
export function pick(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  const rec = o as Obj;
  if (key in rec) return rec[key];
  const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return rec[snake];
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function url(path: string, params: Record<string, string | number | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${FLEA_BASE}/${path}?${q}`;
}

const SPORT: Record<Sport, string> = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL' };

export function toFleaLeagues(raw: unknown, sport: Sport): League[] {
  return arr(pick(raw, 'leagues')).map((l) => ({
    provider: 'fleaflicker' as const,
    id: str(pick(l, 'id')) ?? '',
    name: str(pick(l, 'name')) ?? 'Fleaflicker league',
    sport,
    season: String(new Date().getFullYear()),
    teamCount: num(pick(l, 'size')),
    myTeamId: str(pick(pick(l, 'ownedTeam'), 'id')),
    scoring: null,
  }));
}

export function toFleaTeams(raw: unknown): Team[] {
  const teams = arr(pick(raw, 'divisions')).flatMap((d) => arr(pick(d, 'teams')));
  return rankByRecord(
    teams.map((t) => {
      const rec = pick(t, 'recordOverall');
      const owner = arr(pick(t, 'owners'))[0];
      return {
        id: str(pick(t, 'id')) ?? '',
        name: str(pick(t, 'name')) ?? 'Team',
        owner: str(pick(owner, 'displayName')),
        record: rec
          ? { wins: num(pick(rec, 'wins')) ?? 0, losses: num(pick(rec, 'losses')) ?? 0, ties: num(pick(rec, 'ties')) ?? 0 }
          : null,
        pointsFor: num(pick(pick(t, 'pointsFor'), 'value')),
        pointsAgainst: num(pick(pick(t, 'pointsAgainst'), 'value')),
        rank: num(pick(rec, 'rank')),
      };
    })
  );
}

function groupSlot(group: string | null): Slot {
  if (group === 'BENCH') return 'bench';
  if (group === 'INJURED') return 'ir';
  if (group === 'TAXI') return 'taxi';
  return 'starter';
}

function proPlayer(p: unknown, lineupSlot: string | null, slot: Slot): RosterPlayer | null {
  if (!p) return null;
  const injury = pick(p, 'injury');
  return {
    id: str(pick(p, 'id')) ?? '',
    name: str(pick(p, 'nameFull')) ?? 'Player',
    position: str(pick(p, 'position')),
    lineupSlot,
    slot,
    proTeam: str(pick(p, 'proTeamAbbreviation')),
    injury: str(pick(injury, 'typeFull')) ?? str(pick(injury, 'typeAbbreviaition')) ?? str(pick(injury, 'typeAbbreviation')),
  };
}

/** FetchRoster: players grouped into START / BENCH / INJURED with their slot. */
export function toFleaRoster(teamId: string, raw: unknown): Roster {
  const players = arr(pick(raw, 'groups')).flatMap((g) => {
    const slot = groupSlot(str(pick(g, 'group')));
    return arr(pick(g, 'slots'))
      .map((s) => {
        const label = str(pick(pick(s, 'position'), 'label')) ?? (slot === 'bench' ? 'BN' : null);
        return proPlayer(pick(pick(s, 'leaguePlayer'), 'proPlayer'), label, slot);
      })
      .filter((p): p is RosterPlayer => p !== null);
  });
  return { teamId, players };
}

export function toFleaMatchups(raw: unknown): { period: number | null; matchups: Matchup[] } {
  const period = num(pick(pick(raw, 'schedulePeriod'), 'value')) ?? num(pick(raw, 'scoringPeriod'));
  const matchups = arr(pick(raw, 'games')).map((g) => ({
    period: period ?? 0,
    home: { teamId: str(pick(pick(g, 'home'), 'id')) ?? '', points: num(pick(pick(pick(g, 'homeScore'), 'score'), 'value')) },
    away: pick(g, 'away')
      ? { teamId: str(pick(pick(g, 'away'), 'id')) ?? '', points: num(pick(pick(pick(g, 'awayScore'), 'score'), 'value')) }
      : null,
  }));
  return { period, matchups };
}

export const fleaflickerAdapter: ProviderAdapter<FleaConn> = {
  id: 'fleaflicker',
  label: 'Fleaflicker',
  stability: 'official',
  sports: ['nfl', 'nba', 'mlb', 'nhl'],

  async listLeagues(conn, signal) {
    const all = await Promise.all(
      conn.sport.map(async (sport) =>
        toFleaLeagues(
          await getJson('fleaflicker', url('FetchUserLeagues', { sport: SPORT[sport], email: conn.email.trim() }), { signal }),
          sport
        )
      )
    );
    return all.flat();
  },

  async snapshot(_conn, league, signal) {
    const sport = SPORT[league.sport];
    const [standings, board] = await Promise.all([
      getJson('fleaflicker', url('FetchLeagueStandings', { sport, league_id: league.id }), { signal }),
      getJson('fleaflicker', url('FetchLeagueScoreboard', { sport, league_id: league.id }), { signal }),
    ]);
    const teams = toFleaTeams(standings);
    // FetchLeagueRosters has no lineup slots, so each team's own roster is read.
    const rosters = await Promise.all(
      teams.map(async (t) =>
        toFleaRoster(t.id, await getJson('fleaflicker', url('FetchRoster', { sport, league_id: league.id, team_id: t.id }), { signal }))
      )
    );
    const { period, matchups } = toFleaMatchups(board);
    return { league, teams, rosters, matchups, period, fetchedAt: Date.now() };
  },
};
