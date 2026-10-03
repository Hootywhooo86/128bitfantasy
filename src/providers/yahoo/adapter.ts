/**
 * Yahoo Fantasy Sports API v2 — official, OAuth 2.0.
 *
 * Yahoo's JSON (`?format=json`) is a literal translation of its XML: objects
 * become arrays of one-key objects, lists become objects keyed "0", "1"… plus
 * a "count". `yList` and `yMerge` undo that so the rest reads like normal data.
 */
import { num, rankByRecord, type League, type Matchup, type Roster, type RosterPlayer, type Slot, type Sport, type Team } from '@/src/sports/models';
import { getJson } from '../http';
import type { Connection, ProviderAdapter } from '../types';
import { refreshYahooToken } from './oauth';

type YahooConn = Extract<Connection, { provider: 'yahoo' }>;

/**
 * The API host. Not fantasy.sports.yahoo.com — that is the website, and its
 * /fantasy/v2 path redirects to a 404 page. This bug kept Yahoo from ever
 * loading leagues in the first build.
 */
export const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/** `{ "0": x, "1": y, count: 2 }` → `[x, y]`. */
export function yList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (!isObj(v)) return [];
  return Object.keys(v)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => +a - +b)
    .map((k) => v[k]);
}

/** `[{a:1},{b:2},[{c:3}]]` → `{a:1,b:2,c:3}`. Deep one level, as Yahoo nests. */
export function yMerge(v: unknown): Obj {
  const out: Obj = {};
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObj(x)) Object.assign(out, x);
  };
  walk(v);
  return out;
}

/** The single child of a `{ key: value }` wrapper inside a yList entry. */
const child = (v: unknown, key: string): unknown => (isObj(v) ? v[key] : undefined);

const SPORT_CODE: Record<string, Sport> = { nfl: 'nfl', nba: 'nba', mlb: 'mlb', nhl: 'nhl' };

export function toYahooLeagues(raw: unknown): League[] {
  const users = yList(child(child(raw, 'fantasy_content'), 'users'));
  const user = child(users[0], 'user');
  const games = yList(child(yMerge(Array.isArray(user) ? user.slice(1) : []), 'games'));
  return games.flatMap((g) => {
    const game = child(g, 'game');
    if (!Array.isArray(game)) return [];
    const meta = yMerge(game[0]);
    const sport = SPORT_CODE[str(meta.code) ?? ''];
    if (!sport) return [];
    const leagues = yList(child(yMerge(game.slice(1)), 'leagues'));
    return leagues.map((l) => {
      const m = yMerge(child(l, 'league'));
      return {
        provider: 'yahoo' as const,
        id: str(m.league_key) ?? '',
        name: str(m.name) ?? 'Yahoo league',
        sport,
        season: str(m.season) ?? str(meta.season) ?? '',
        teamCount: num(m.num_teams),
        myTeamId: null,
        scoring: scoringLabel(str(m.scoring_type)),
      };
    });
  });
}

function scoringLabel(t: string | null): string | null {
  if (!t) return null;
  return { head: 'H2H Categories', headpoint: 'H2H Points', point: 'Points', roto: 'Roto', headone: 'H2H One Win' }[t] ?? t;
}

/** A Yahoo team array: [ [meta…], {team_points}, {team_standings}, {roster}… ]. */
function teamParts(team: unknown): { meta: Obj; rest: Obj } {
  const arr = Array.isArray(team) ? team : [];
  return { meta: yMerge(arr[0]), rest: yMerge(arr.slice(1)) };
}

export function toYahooTeams(raw: unknown): { teams: Team[]; myTeamId: string | null } {
  const league = child(child(raw, 'fantasy_content'), 'league');
  const body = yMerge(Array.isArray(league) ? league.slice(1) : []);
  const standings = yMerge(body.standings);
  let myTeamId: string | null = null;
  const teams = yList(standings.teams).map((t) => {
    const { meta, rest } = teamParts(child(t, 'team'));
    const id = str(meta.team_key) ?? '';
    if (num(meta.is_owned_by_current_login) === 1) myTeamId = id;
    const st = isObj(rest.team_standings) ? rest.team_standings : {};
    const ot = isObj(st.outcome_totals) ? st.outcome_totals : null;
    const manager = child(yList(meta.managers)[0], 'manager');
    return {
      id,
      name: str(meta.name) ?? 'Team',
      owner: isObj(manager) ? str(manager.nickname) : null,
      record: ot ? { wins: num(ot.wins) ?? 0, losses: num(ot.losses) ?? 0, ties: num(ot.ties) ?? 0 } : null,
      pointsFor: num(st.points_for) ?? num(child(rest.team_points, 'total')),
      pointsAgainst: num(st.points_against),
      rank: num(st.rank),
    };
  });
  return { teams: rankByRecord(teams), myTeamId };
}

function slotOf(pos: string | null): Slot {
  if (pos === 'BN') return 'bench';
  if (pos === 'IR' || pos === 'IR+' || pos === 'IL' || pos === 'IL+' || pos === 'IL10' || pos === 'IL60' || pos === 'DL') return 'ir';
  if (pos === 'NA') return 'taxi';
  return 'starter';
}

export function toYahooRosters(raw: unknown): Roster[] {
  const league = child(child(raw, 'fantasy_content'), 'league');
  const body = yMerge(Array.isArray(league) ? league.slice(1) : []);
  return yList(body.teams).map((t) => {
    const { meta, rest } = teamParts(child(t, 'team'));
    const roster = yMerge(yList(rest.roster)[0] ?? child(rest.roster, '0'));
    const players = yList(roster.players).map((p): RosterPlayer => {
      const arr = child(p, 'player');
      const pm = yMerge(Array.isArray(arr) ? arr[0] : []);
      const extra = yMerge(Array.isArray(arr) ? arr.slice(1) : []);
      const sel = yMerge(extra.selected_position);
      const lineupSlot = str(sel.position);
      const name = isObj(pm.name) ? str(pm.name.full) : null;
      return {
        id: str(pm.player_key) ?? '',
        name: name ?? 'Player',
        position: str(pm.display_position),
        lineupSlot,
        slot: slotOf(lineupSlot),
        proTeam: str(pm.editorial_team_abbr)?.toUpperCase() ?? null,
        injury: str(pm.status_full) ?? str(pm.status),
      };
    });
    return { teamId: str(meta.team_key) ?? '', players };
  });
}

export function toYahooMatchups(raw: unknown): { period: number | null; matchups: Matchup[] } {
  const league = child(child(raw, 'fantasy_content'), 'league');
  const body = yMerge(Array.isArray(league) ? league.slice(1) : []);
  const board = isObj(body.scoreboard) ? body.scoreboard : {};
  const period = num(board.week);
  const inner = yMerge(yList(board)[0] ?? child(board, '0'));
  const matchups = yList(inner.matchups).map((m) => {
    const mm = child(m, 'matchup');
    const mo = isObj(mm) ? mm : {};
    const sides = yList(child(yMerge(yList(mo)[0] ?? mo['0']), 'teams')).map((t) => {
      const { meta, rest } = teamParts(child(t, 'team'));
      return { teamId: str(meta.team_key) ?? '', points: num(child(rest.team_points, 'total')) };
    });
    const week = num(mo.week) ?? period ?? 0;
    return { period: week, home: sides[0] ?? { teamId: '', points: null }, away: sides[1] ?? null };
  });
  return { period, matchups };
}

/**
 * Hands back a token that is good for at least a minute, refreshing if not.
 * `onRefresh` persists the new pair so the next launch does not refresh again.
 */
export async function freshToken(
  conn: YahooConn,
  onRefresh: (c: YahooConn) => Promise<void>
): Promise<string> {
  if (Date.now() < conn.expiresAt) return conn.accessToken;
  const t = await refreshYahooToken(conn.clientId, conn.clientSecret, conn.refreshToken);
  const next = { ...conn, ...t };
  await onRefresh(next);
  return next.accessToken;
}

export function createYahooAdapter(onRefresh: (c: YahooConn) => Promise<void>): ProviderAdapter<YahooConn> {
  const get = async (conn: YahooConn, path: string, signal?: AbortSignal) =>
    getJson('yahoo', `${YAHOO_API}/${path}${path.includes('?') ? '&' : '?'}format=json`, {
      signal,
      headers: { Authorization: `Bearer ${await freshToken(conn, onRefresh)}` },
    });

  return {
    id: 'yahoo',
    label: 'Yahoo',
    stability: 'official',
    sports: ['nfl', 'nba', 'mlb', 'nhl'],

    async listLeagues(conn, signal) {
      const leagues = toYahooLeagues(await get(conn, 'users;use_login=1/games;game_keys=nfl,nba,mlb,nhl/leagues', signal));
      // Yahoo lists every season the user has played; keep the live ones.
      const latest = new Map<Sport, string>();
      for (const l of leagues) if ((latest.get(l.sport) ?? '') < l.season) latest.set(l.sport, l.season);
      return leagues.filter((l) => latest.get(l.sport) === l.season);
    },

    async snapshot(conn, league, signal) {
      const key = encodeURIComponent(league.id);
      const [standings, rosters, board] = await Promise.all([
        get(conn, `league/${key}/standings`, signal),
        get(conn, `league/${key}/teams/roster`, signal),
        get(conn, `league/${key}/scoreboard`, signal),
      ]);
      const { teams, myTeamId } = toYahooTeams(standings);
      const { period, matchups } = toYahooMatchups(board);
      return {
        league: { ...league, myTeamId: myTeamId ?? league.myTeamId },
        teams,
        rosters: toYahooRosters(rosters),
        matchups,
        period,
        fetchedAt: Date.now(),
      };
    },
  };
}
