import {
  num,
  rankByRecord,
  type League,
  type LeagueSnapshot,
  type Matchup,
  type Roster,
  type RosterPlayer,
  type Sport,
  type Team,
} from '@/src/sports/models';
import type { Connection, ProviderAdapter } from '../types';
import {
  sleeper,
  type SleeperLeague,
  type SleeperLeagueUser,
  type SleeperMatchup,
  type SleeperPlayers,
  type SleeperRoster,
  type SleeperSport,
  type SleeperState,
} from './client';

type SleeperConn = Extract<Connection, { provider: 'sleeper' }>;

const SPORTS: SleeperSport[] = ['nfl', 'nba'];

/** Player catalog loader. Injected so the adapter stays free of storage. */
export type PlayerLookup = (sport: SleeperSport, signal?: AbortSignal) => Promise<SleeperPlayers>;

export function scoringLabel(l: SleeperLeague): string | null {
  const rec = l.scoring_settings?.rec;
  if (l.sport !== 'nfl' || rec == null) return null;
  if (rec >= 1) return 'PPR';
  if (rec === 0.5) return 'Half PPR';
  if (rec === 0) return 'Standard';
  return `${rec} PPR`;
}

export function toLeague(l: SleeperLeague, myUserId: string, rosters?: SleeperRoster[]): League {
  const mine = rosters?.find((r) => r.owner_id === myUserId);
  return {
    provider: 'sleeper',
    id: l.league_id,
    name: l.name,
    sport: l.sport as Sport,
    season: l.season,
    teamCount: l.total_rosters ?? null,
    myTeamId: mine ? String(mine.roster_id) : null,
    scoring: scoringLabel(l),
  };
}

/** Sleeper splits points into an integer part and two decimals. */
function pts(whole?: number, dec?: number): number | null {
  if (whole == null) return null;
  return whole + (dec ?? 0) / 100;
}

export function toTeams(rosters: SleeperRoster[], users: SleeperLeagueUser[]): Team[] {
  const byUser = new Map(users.map((u) => [u.user_id, u]));
  const teams = rosters.map((r): Team => {
    const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
    const s = r.settings ?? {};
    return {
      id: String(r.roster_id),
      name: u?.metadata?.team_name?.trim() || u?.display_name || `Team ${r.roster_id}`,
      owner: u?.display_name ?? null,
      record: { wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0 },
      pointsFor: pts(s.fpts, s.fpts_decimal),
      pointsAgainst: pts(s.fpts_against, s.fpts_against_decimal),
      rank: s.rank ?? null,
    };
  });
  return rankByRecord(teams);
}

function playerName(id: string, p: SleeperPlayers[string] | undefined): string {
  if (!p) return id;
  if (p.full_name) return p.full_name;
  const n = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return n || id;
}

export function toRoster(r: SleeperRoster, positions: string[], catalog: SleeperPlayers): Roster {
  // roster_positions includes the bench and IR slots; starters[] lines up with
  // the ones before them, in order.
  const startSlots = positions.filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
  const ir = new Set(r.reserve ?? []);
  const taxi = new Set(r.taxi ?? []);
  const starters = r.starters ?? [];
  const seen = new Set<string>();

  const make = (id: string, slot: RosterPlayer['slot'], lineupSlot: string | null): RosterPlayer => {
    const p = catalog[id];
    return {
      id,
      name: playerName(id, p),
      position: p?.position ?? null,
      lineupSlot,
      slot,
      proTeam: p?.team ?? null,
      injury: p?.injury_status ?? null,
    };
  };

  const players: RosterPlayer[] = [];
  const emptySlots: string[] = [];
  starters.forEach((id, i) => {
    // "0" marks an empty starting slot.
    if (!id || id === '0') {
      emptySlots.push(startSlots[i] ?? 'slot');
      return;
    }
    seen.add(id);
    players.push(make(id, 'starter', startSlots[i] ?? null));
  });
  for (const id of r.players ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (ir.has(id)) players.push(make(id, 'ir', 'IR'));
    else if (taxi.has(id)) players.push(make(id, 'taxi', 'TAXI'));
    else players.push(make(id, 'bench', 'BN'));
  }
  return { teamId: String(r.roster_id), players, emptySlots };
}

export function toMatchups(rows: SleeperMatchup[], week: number): Matchup[] {
  const groups = new Map<number, SleeperMatchup[]>();
  const out: Matchup[] = [];
  for (const row of rows) {
    if (row.matchup_id == null) {
      // A bye, or a median-scoring league's extra slot.
      out.push({ period: week, home: { teamId: String(row.roster_id), points: num(row.points) }, away: null });
      continue;
    }
    const g = groups.get(row.matchup_id) ?? [];
    g.push(row);
    groups.set(row.matchup_id, g);
  }
  for (const [, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    const [a, b] = g;
    out.push({
      period: week,
      home: { teamId: String(a.roster_id), points: num(a.points) },
      away: b ? { teamId: String(b.roster_id), points: num(b.points) } : null,
    });
  }
  return out;
}

export function currentWeek(state: SleeperState): number | null {
  if (state.season_type === 'off') return null;
  if (state.season_type === 'pre') return 1;
  return Math.max(1, state.display_week ?? state.week);
}

export function createSleeperAdapter(players: PlayerLookup): ProviderAdapter<SleeperConn> {
  return {
    id: 'sleeper',
    label: 'Sleeper',
    stability: 'official',
    sports: ['nfl', 'nba'],

    async listLeagues(conn, signal) {
      const user = await sleeper.user(conn.username, { signal });
      const perSport = await Promise.all(
        SPORTS.map(async (sport) => {
          const state = await sleeper.state(sport, { signal });
          const leagues = await sleeper.leagues(user.user_id, sport, state.league_season ?? state.season, { signal });
          return Promise.all(
            (leagues ?? []).map(async (l) => toLeague(l, user.user_id, await sleeper.rosters(l.league_id, { signal })))
          );
        })
      );
      return perSport.flat();
    },

    async snapshot(_conn, league, signal): Promise<LeagueSnapshot> {
      const sport = league.sport as SleeperSport;
      const [raw, users, rosters, state, catalog] = await Promise.all([
        sleeper.league(league.id, { signal }),
        sleeper.users(league.id, { signal }),
        sleeper.rosters(league.id, { signal }),
        sleeper.state(sport, { signal }),
        players(sport, signal),
      ]);
      const week = currentWeek(state);
      const matchups = week ? await sleeper.matchups(league.id, week, { signal }) : [];
      return {
        league: { ...league, scoring: scoringLabel(raw) ?? league.scoring },
        teams: toTeams(rosters, users),
        rosters: rosters.map((r) => toRoster(r, raw.roster_positions ?? [], catalog)),
        matchups: toMatchups(matchups ?? [], week ?? 0),
        period: week,
        fetchedAt: Date.now(),
      };
    },
  };
}
