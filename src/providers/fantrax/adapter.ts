/**
 * Fantrax — QUARANTINED. Expect breakage.
 *
 * Fantrax has no documented public API. What exists is `fxea/general`, a
 * read-only feed that works without login for leagues their commissioner has
 * made publicly viewable:
 *
 *   getLeagues?userSecretId=…   the user's leagues (often empty — see below)
 *   getLeagueInfo?leagueId=…    name, teamInfo, matchups schedule, scoring type
 *   getTeamRosters?leagueId=…   rosterItems: { id, position, status } per team
 *   getStandings?leagueId=…     undocumented shape; parsed defensively
 *   getPlayerIds?sport=NFL      fantraxId → { name, team, position }
 *
 * Field names are from the go-fantrax client, which reads the same feed.
 * Private leagues need the logged-in `fxpa/req` endpoints; deliberately not
 * done here. Live scores are not in this feed, so matchup points are null.
 *
 * Every read here is defensive: an unknown shape yields empty data, never a
 * crash, and never a made-up number.
 */
import { num, rankByRecord, type League, type Matchup, type Roster, type Slot, type Sport, type Team } from '@/src/sports/models';
import { getJson } from '../http';
import type { Connection, ProviderAdapter } from '../types';

type FantraxConn = Extract<Connection, { provider: 'fantrax' }>;

export const FANTRAX_BASE = 'https://www.fantrax.com/fxea/general';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

export type FantraxPlayers = Record<string, { name?: string; team?: string; position?: string }>;
export type FantraxPlayerLookup = (sport: Sport, signal?: AbortSignal) => Promise<FantraxPlayers>;

const SPORT_CODE: Record<Sport, string> = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL' };

export function fantraxSport(code: unknown): Sport | null {
  const c = s(code)?.toUpperCase();
  return (Object.entries(SPORT_CODE).find(([, v]) => v === c)?.[0] as Sport | undefined) ?? null;
}

export function toFantraxLeagues(raw: unknown): League[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.leagues) ? raw.leagues : [];
  return list.filter(isObj).flatMap((l) => {
    const id = s(l.leagueId) ?? s(l.id);
    const sport = fantraxSport(l.sport);
    if (!id || !sport) return [];
    return [
      {
        provider: 'fantrax' as const,
        id,
        name: s(l.leagueName) ?? s(l.name) ?? 'Fantrax league',
        sport,
        season: s(l.season) ?? String(new Date().getFullYear()),
        teamCount: null,
        myTeamId: s(l.teamId),
        scoring: null,
      },
    ];
  });
}

export function toFantraxLeague(id: string, info: unknown, base?: Partial<League>): League {
  const i = isObj(info) ? info : {};
  const teamInfo = isObj(i.teamInfo) ? i.teamInfo : {};
  const scoringType = isObj(i.scoringSystem) ? s(i.scoringSystem.type) : null;
  return {
    provider: 'fantrax',
    id,
    name: s(i.leagueName) ?? base?.name ?? 'Fantrax league',
    sport: base?.sport ?? 'nfl',
    season: base?.season ?? String(new Date().getFullYear()),
    teamCount: Object.keys(teamInfo).length || null,
    myTeamId: base?.myTeamId ?? null,
    scoring: scoringType ? scoringType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null,
  };
}

/** "3-1-0" or "3-1" → record. */
export function parseWlt(v: unknown): { wins: number; losses: number; ties: number } | null {
  const m = s(v)?.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  return { wins: +m[1], losses: +m[2], ties: m[3] ? +m[3] : 0 };
}

export function toFantraxTeams(info: unknown, standings: unknown): Team[] {
  const teamInfo = isObj(info) && isObj(info.teamInfo) ? info.teamInfo : {};
  const rows = Array.isArray(standings)
    ? standings
    : isObj(standings)
      ? Object.values(standings).find(Array.isArray) ?? Object.values(standings)
      : [];
  const byId = new Map<string, Obj>();
  for (const r of rows as unknown[]) {
    if (!isObj(r)) continue;
    const id = s(r.teamId) ?? s(r.id);
    if (id) byId.set(id, r);
  }
  return rankByRecord(
    Object.entries(teamInfo).map(([key, t]) => {
      const ti = isObj(t) ? t : {};
      const id = s(ti.id) ?? key;
      const row = byId.get(id) ?? {};
      return {
        id,
        name: s(ti.name) ?? s(row.teamName) ?? 'Team',
        owner: null,
        record: parseWlt(row.winLossTies) ?? parseWlt(row.record),
        pointsFor: num(row.points) ?? num(row.pointsFor),
        pointsAgainst: num(row.pointsAgainst),
        rank: num(row.rank),
      };
    })
  );
}

function statusSlot(status: string | null): Slot {
  switch (status) {
    case 'ACTIVE':
      return 'starter';
    case 'INJURED_RESERVE':
      return 'ir';
    case 'MINORS':
      return 'taxi';
    default:
      return 'bench';
  }
}

export function toFantraxRosters(raw: unknown, players: FantraxPlayers): { period: number | null; rosters: Roster[] } {
  const r = isObj(raw) ? raw : {};
  const rosters = isObj(r.rosters) ? r.rosters : {};
  return {
    period: num(r.period),
    rosters: Object.entries(rosters).map(([teamId, team]) => ({
      teamId,
      players: (isObj(team) && Array.isArray(team.rosterItems) ? team.rosterItems : []).filter(isObj).map((it) => {
        const id = s(it.id) ?? '';
        const p = players[id];
        const slot = statusSlot(s(it.status));
        return {
          id,
          name: p?.name ?? id,
          position: s(it.position) ?? p?.position ?? null,
          lineupSlot: slot === 'starter' ? s(it.position) : slot === 'bench' ? 'BN' : slot === 'ir' ? 'IR' : 'MIN',
          slot,
          proTeam: p?.team ?? null,
          injury: null,
        };
      }),
    })),
  };
}

export function toFantraxMatchups(info: unknown, period: number | null): Matchup[] {
  if (period == null || !isObj(info) || !Array.isArray(info.matchups)) return [];
  const row = info.matchups.filter(isObj).find((m) => num(m.period) === period);
  const list = row && Array.isArray(row.matchupList) ? row.matchupList.filter(isObj) : [];
  return list.map((m) => ({
    period,
    // The public feed has the schedule but no live scores.
    home: { teamId: (isObj(m.home) && s(m.home.id)) || '', points: null },
    away: isObj(m.away) && s(m.away.id) ? { teamId: s(m.away.id)!, points: null } : null,
  }));
}

const q = (path: string, params: Record<string, string>) =>
  `${FANTRAX_BASE}/${path}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;

/** Fantrax answers an unknown league with 200 and an `error` object. */
function assertOk(raw: unknown): void {
  if (isObj(raw) && isObj(raw.error)) {
    const msg = s(raw.error.message) ?? 'Fantrax refused the request.';
    throw new Error(`${msg} The league must be publicly viewable for the read-only feed.`);
  }
}

export function createFantraxAdapter(players: FantraxPlayerLookup): ProviderAdapter<FantraxConn> {
  return {
    id: 'fantrax',
    label: 'Fantrax',
    stability: 'experimental',
    sports: ['nfl', 'nba', 'mlb', 'nhl'],

    async listLeagues(conn, signal) {
      const listed = conn.userSecretId
        ? toFantraxLeagues(await getJson('fantrax', q('getLeagues', { userSecretId: conn.userSecretId.trim() }), { signal }))
        : [];
      const known = new Set(listed.map((l) => l.id));
      const manual = await Promise.all(
        conn.leagueIds
          .filter((id) => !known.has(id))
          .map(async (id) => {
            const info = await getJson('fantrax', q('getLeagueInfo', { leagueId: id }), { signal });
            assertOk(info);
            return toFantraxLeague(id, info);
          })
      );
      return [...listed, ...manual];
    },

    async snapshot(_conn, league, signal) {
      const [info, rostersRaw, standings, catalog] = await Promise.all([
        getJson('fantrax', q('getLeagueInfo', { leagueId: league.id }), { signal }),
        getJson('fantrax', q('getTeamRosters', { leagueId: league.id }), { signal }),
        getJson('fantrax', q('getStandings', { leagueId: league.id }), { signal }).catch(() => null),
        players(league.sport, signal).catch(() => ({}) as FantraxPlayers),
      ]);
      assertOk(info);
      const { period, rosters } = toFantraxRosters(rostersRaw, catalog);
      return {
        league: toFantraxLeague(league.id, info, league),
        teams: toFantraxTeams(info, standings),
        rosters,
        matchups: toFantraxMatchups(info, period),
        period,
        fetchedAt: Date.now(),
      };
    },
  };
}

export function fantraxPlayersUrl(sport: Sport): string {
  return q('getPlayerIds', { sport: SPORT_CODE[sport] });
}
