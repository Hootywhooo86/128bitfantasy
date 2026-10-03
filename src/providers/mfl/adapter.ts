/**
 * MyFantasyLeague — official export API, read-only, NFL.
 * Docs: https://api.myfantasyleague.com/2026/api_info
 *
 * Public leagues read without login; that is most MFL leagues. Shapes taken
 * from a live 2026 league:
 *
 *   TYPE=league           name, franchises.franchise[{id,name}], starters
 *   TYPE=rosters          rosters.franchise[{id, player[{id, status}]}]  ROSTER | INJURED_RESERVE | TAXI_SQUAD
 *   TYPE=leagueStandings  leagueStandings.franchise[{id, h2hwlt "3-0-0", pf, pa}]
 *   TYPE=liveScoring      liveScoring{week, matchup[{franchise[{id, score, players.player[{id,status:'starter'}]}]}]}
 *   TYPE=players          players.player[{id, name "Last, First", position, team}]
 *   TYPE=injuries         injuries.injury[{id, status}]
 *
 * MFL collapses one-item lists into a bare object, so every list goes
 * through `list()`.
 */
import { num, rankByRecord, type League, type Matchup, type Roster, type Slot, type Team } from '@/src/sports/models';
import { getJson } from '../http';
import type { Connection, ProviderAdapter } from '../types';
import { parseWlt } from '../fantrax/adapter';

type MflConn = Extract<Connection, { provider: 'mfl' }>;

export const MFL_BASE = 'https://api.myfantasyleague.com';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/** MFL sends a single item as an object and several as an array. */
export function list(v: unknown): Obj[] {
  if (Array.isArray(v)) return v.filter(isObj);
  return isObj(v) ? [v] : [];
}

/** "Prescott, Dak" → "Dak Prescott". Team defenses stay as sent. */
export function mflName(n: string): string {
  const m = n.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : n;
}

export function mflSeason(now = new Date()): number {
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

export function exportUrl(season: number | string, type: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ TYPE: type, ...params, JSON: '1' });
  return `${MFL_BASE}/${season}/export?${q.toString()}`;
}

/** MFL answers a bad league id with 200 and `{ error: { $t } }`. */
export function assertMfl(raw: unknown): void {
  if (isObj(raw) && isObj(raw.error)) {
    throw new Error(`MyFantasyLeague: ${str(raw.error.$t) ?? 'request refused'}. Check the league ID; private leagues can't be read.`);
  }
}

export type MflPlayers = Record<string, { name: string; position: string | null; team: string | null }>;

export function toMflPlayers(raw: unknown): MflPlayers {
  const out: MflPlayers = {};
  const players = isObj(raw) && isObj(raw.players) ? list(raw.players.player) : [];
  for (const p of players) {
    const id = str(p.id);
    if (!id) continue;
    out[id] = { name: mflName(str(p.name) ?? id), position: str(p.position), team: str(p.team) };
  }
  return out;
}

export function toMflInjuries(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const inj = isObj(raw) && isObj(raw.injuries) ? list(raw.injuries.injury) : [];
  for (const i of inj) {
    const id = str(i.id);
    const st = str(i.status);
    if (id && st && st !== 'RETIRED') out[id] = st;
  }
  return out;
}

export function toMflLeague(raw: unknown, season: string, myFranchise: string | null): League {
  const l = isObj(raw) && isObj(raw.league) ? raw.league : {};
  const franchises = isObj(l.franchises) ? list(l.franchises.franchise) : [];
  return {
    provider: 'mfl',
    id: str(l.id) ?? '',
    name: str(l.name) ?? 'MFL league',
    sport: 'nfl',
    season,
    teamCount: franchises.length || null,
    myTeamId: myFranchise,
    scoring: str(l.h2h) === 'YES' ? 'H2H Points' : 'Points',
  };
}

export function toMflTeams(leagueRaw: unknown, standingsRaw: unknown): Team[] {
  const l = isObj(leagueRaw) && isObj(leagueRaw.league) ? leagueRaw.league : {};
  const franchises = isObj(l.franchises) ? list(l.franchises.franchise) : [];
  const rows = isObj(standingsRaw) && isObj(standingsRaw.leagueStandings) ? list(standingsRaw.leagueStandings.franchise) : [];
  const byId = new Map(rows.map((r) => [str(r.id), r]));
  // Standings arrive already sorted by the league's own tiebreakers.
  const order = new Map(rows.map((r, i) => [str(r.id), i + 1]));
  return rankByRecord(
    franchises.map((f) => {
      const id = str(f.id) ?? '';
      const r = byId.get(id) ?? {};
      return {
        id,
        name: str(f.name) ?? `Franchise ${id}`,
        owner: str(f.owner_name),
        record: parseWlt(r.h2hwlt),
        pointsFor: num(r.pf),
        pointsAgainst: num(r.pa),
        rank: order.get(id) ?? null,
      };
    })
  );
}

function statusSlot(s: string | null): Slot {
  if (s === 'INJURED_RESERVE') return 'ir';
  if (s === 'TAXI_SQUAD') return 'taxi';
  return 'bench';
}

export function toMflRosters(
  rostersRaw: unknown,
  liveRaw: unknown,
  players: MflPlayers,
  injuries: Record<string, string>
): Roster[] {
  const starters = new Set<string>();
  const scores = new Map<string, number | null>();
  const live = isObj(liveRaw) && isObj(liveRaw.liveScoring) ? liveRaw.liveScoring : {};
  for (const m of list(live.matchup))
    for (const f of list(m.franchise)) {
      const ps = isObj(f.players) ? list(f.players.player) : [];
      for (const p of ps) {
        const k = `${str(f.id)}:${str(p.id)}`;
        if (str(p.status) === 'starter') starters.add(k);
        scores.set(k, num(p.score));
      }
    }
  const franchises = isObj(rostersRaw) && isObj(rostersRaw.rosters) ? list(rostersRaw.rosters.franchise) : [];
  return franchises.map((f) => {
    const fid = str(f.id) ?? '';
    return {
      teamId: fid,
      players: list(f.player).map((p) => {
        const id = str(p.id) ?? '';
        const info = players[id];
        const slot: Slot = starters.has(`${fid}:${id}`) ? 'starter' : statusSlot(str(p.status));
        return {
          id,
          name: info?.name ?? id,
          position: info?.position ?? null,
          lineupSlot: slot === 'starter' ? info?.position ?? null : slot === 'ir' ? 'IR' : slot === 'taxi' ? 'TAXI' : 'BN',
          slot,
          proTeam: info?.team ?? null,
          injury: injuries[id] ?? null,
          // Live scoring lists starters; bench players have no live score.
          points: scores.get(`${fid}:${id}`) ?? null,
        };
      }),
    };
  });
}

export function toMflMatchups(liveRaw: unknown): { period: number | null; matchups: Matchup[] } {
  const live = isObj(liveRaw) && isObj(liveRaw.liveScoring) ? liveRaw.liveScoring : {};
  const period = num(live.week);
  const matchups = list(live.matchup).map((m) => {
    const fs = list(m.franchise);
    // Home side first when MFL says which is home.
    fs.sort((a, b) => (str(b.isHome) === '1' ? 1 : 0) - (str(a.isHome) === '1' ? 1 : 0));
    const side = (f: Obj | undefined) => (f ? { teamId: str(f.id) ?? '', points: num(f.score) } : null);
    return { period: period ?? 0, home: side(fs[0])!, away: side(fs[1]) };
  });
  return { period, matchups: matchups.filter((m) => m.home) };
}

export type MflPlayerLookup = (season: number, signal?: AbortSignal) => Promise<MflPlayers>;

export function createMflAdapter(players: MflPlayerLookup): ProviderAdapter<MflConn> {
  return {
    id: 'mfl',
    label: 'MyFantasyLeague',
    stability: 'official',
    sports: ['nfl'],

    async listLeagues(conn, signal) {
      const season = mflSeason();
      return Promise.all(
        conn.leagues.map(async ({ id, franchiseId }) => {
          const raw = await getJson('mfl', exportUrl(season, 'league', { L: id }), { signal });
          assertMfl(raw);
          return toMflLeague(raw, String(season), franchiseId ? franchiseId.padStart(4, '0') : null);
        })
      );
    },

    async snapshot(_conn, league, signal) {
      const L = { L: league.id };
      const [lg, rosters, standings, live, injuries, catalog] = await Promise.all([
        getJson('mfl', exportUrl(league.season, 'league', L), { signal }),
        getJson('mfl', exportUrl(league.season, 'rosters', L), { signal }),
        getJson('mfl', exportUrl(league.season, 'leagueStandings', L), { signal }).catch(() => null),
        getJson('mfl', exportUrl(league.season, 'liveScoring', L), { signal }).catch(() => null),
        getJson('mfl', exportUrl(league.season, 'injuries'), { signal }).catch(() => null),
        players(Number(league.season), signal).catch(() => ({}) as MflPlayers),
      ]);
      assertMfl(lg);
      const { period, matchups } = toMflMatchups(live);
      return {
        league: { ...toMflLeague(lg, league.season, league.myTeamId), id: league.id },
        teams: toMflTeams(lg, standings),
        rosters: toMflRosters(rosters, live, catalog, toMflInjuries(injuries)),
        matchups,
        period,
        fetchedAt: Date.now(),
      };
    },
  };
}
