/**
 * A hosted league as a LeagueSnapshot, so Home, the team screen, Lineup
 * Check, Coaches Corner and alerts all work on it unchanged.
 */
import type { League, LeagueSnapshot, Matchup, Roster, RosterPlayer, Team } from '@/src/sports/models';
import { categoryDefs, h2hCats } from './categories';
import type { HostedSport } from './scoring';
import { isStarting, teamWeek, type GameStat, type LineupMove } from './season';
import { leagueTable, matchupsForWeek, type WeekRow } from './standings';
import { FORMAT_LABELS, type HostedMatchup, type HostedTeam, type LeagueSettings, type PoolPlayer, type RosterEntry } from './types';

export type HostedInput = {
  league: { id: string; name: string; sport: HostedSport; season: string; status: string; settings: LeagueSettings };
  teams: HostedTeam[];
  roster: (RosterEntry & { position: string })[];
  matchups: HostedMatchup[];
  log: LineupMove[];
  weekScores: WeekRow[];
  myTeamId: string | null;
};

export function asLeague(
  i: { league: { id: string; name: string; sport: HostedSport; season: string; settings?: Partial<LeagueSettings> | null }; myTeamId: string | null; teamCount: number | null }
): League {
  const f = i.league.settings?.format;
  return {
    provider: 'bit128',
    id: i.league.id,
    name: i.league.name,
    sport: i.league.sport,
    season: i.league.season,
    teamCount: i.teamCount,
    myTeamId: i.myTeamId,
    scoring: f ? FORMAT_LABELS[f] : 'Head-to-head points',
  };
}

const slotKind = (slot: string): RosterPlayer['slot'] => (slot === 'IR' ? 'ir' : isStarting(slot) ? 'starter' : 'bench');

export function hostedSnapshot(i: HostedInput, pool: Map<string, PoolPlayer>, week: number, stats: GameStat[], now = Date.now()): LeagueSnapshot {
  const s = i.league.settings;
  const sport = i.league.sport;
  const ids = i.teams.map((t) => t.id);
  const table = leagueTable(sport, s, ids, i.matchups, i.weekScores);
  const row = new Map(table.map((r) => [r.teamId, r]));
  const played = i.weekScores.length > 0;
  const teams: Team[] = i.teams.map((t) => {
    const r = row.get(t.id);
    return {
      id: t.id,
      name: t.name,
      owner: null,
      record: r ? { wins: r.wins, losses: r.losses, ties: r.ties } : null,
      // Roto shows its roto points; everything else its fantasy points.
      pointsFor: s.format === 'roto' ? (r?.score ?? 0) : (r?.pointsFor ?? 0),
      pointsAgainst: r?.pointsAgainst ?? 0,
      rank: played && r ? r.rank : null,
    };
  });

  const weekBy = new Map(i.teams.map((t) => [t.id, teamWeek(t.id, i.log, stats, s.scoring)]));
  const rosters: Roster[] = i.teams.map((t) => {
    const mine = i.roster.filter((r) => r.teamId === t.id);
    const pts = new Map((weekBy.get(t.id)?.players ?? []).map((p) => [p.playerId, p.points]));
    const used: Record<string, number> = {};
    for (const r of mine) used[r.slot] = (used[r.slot] ?? 0) + 1;
    const emptySlots = Object.entries(s.slots).flatMap(([slot, n]) => Array<string>(Math.max(0, n - (used[slot] ?? 0))).fill(slot));
    return {
      teamId: t.id,
      emptySlots,
      players: mine.map((r) => {
        const p = pool.get(r.playerId);
        return {
          id: r.playerId,
          name: p?.name ?? r.playerId,
          position: p?.position ?? r.position,
          lineupSlot: r.slot,
          slot: slotKind(r.slot),
          proTeam: p?.team ?? null,
          injury: null,
          projected: null,
          // Bench players' games don't count, so they show no points rather than 0.
          points: pts.get(r.playerId) ?? (isStarting(r.slot) ? 0 : null),
        };
      }),
    };
  });

  const defs = categoryDefs(sport, s.categories);
  const cats = s.format === 'h2h_cats' || s.format === 'h2h_most_cats';
  const divisionOf = new Map(i.teams.map((t) => [t.id, t.division ?? null]));
  const matchups: Matchup[] = matchupsForWeek(sport, s, ids, i.matchups, i.weekScores, week, i.league.id, divisionOf).map((m) => {
    const a = weekBy.get(m.home);
    const b = m.away ? weekBy.get(m.away) : null;
    // Category formats show categories won, the way the scoreboard reads.
    if (cats && a && b) {
      const r = h2hCats(defs, a.line, b.line);
      return { period: week, home: { teamId: m.home, points: r.wins }, away: { teamId: m.away!, points: r.losses } };
    }
    return {
      period: week,
      home: { teamId: m.home, points: a?.total ?? 0 },
      away: m.away ? { teamId: m.away, points: b?.total ?? 0 } : null,
    };
  });

  return {
    league: asLeague({ league: i.league, myTeamId: i.myTeamId, teamCount: i.teams.length }),
    teams,
    rosters,
    matchups,
    period: week,
    fetchedAt: now,
  };
}
