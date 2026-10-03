/**
 * A hosted league as a LeagueSnapshot, so Home, the team screen, Lineup
 * Check, Coaches Corner and alerts all work on it unchanged.
 */
import type { League, LeagueSnapshot, Matchup, Roster, RosterPlayer, Team } from '@/src/sports/models';
import { isStarting, standings, teamWeek, type GameStat, type LineupMove, type WeekResult } from './season';
import type { ScoringRules } from './scoring';
import type { HostedMatchup, HostedTeam, PoolPlayer, RosterEntry } from './types';

export type HostedInput = {
  league: { id: string; name: string; sport: 'nhl' | 'nfl'; season: string; status: string };
  teams: HostedTeam[];
  roster: (RosterEntry & { position: string })[];
  matchups: HostedMatchup[];
  log: LineupMove[];
  weekScores: { week: number; teamId: string; points: number }[];
  myTeamId: string | null;
};

export function asLeague(i: Pick<HostedInput, 'league' | 'myTeamId'> & { teamCount: number | null }): League {
  return {
    provider: 'bit128',
    id: i.league.id,
    name: i.league.name,
    sport: i.league.sport,
    season: i.league.season,
    teamCount: i.teamCount,
    myTeamId: i.myTeamId,
    scoring: 'H2H Points',
  };
}

/** Finished weeks as results, from the recorded week scores. */
export function weekResults(matchups: HostedMatchup[], weekScores: HostedInput['weekScores'], beforeWeek: number): WeekResult[] {
  const pts = new Map(weekScores.map((w) => [`${w.week}:${w.teamId}`, w.points]));
  const out: WeekResult[] = [];
  for (const m of matchups) {
    if (m.week >= beforeWeek) continue;
    const h = pts.get(`${m.week}:${m.home}`);
    if (h == null) continue;
    const a = m.away ? pts.get(`${m.week}:${m.away}`) : null;
    if (m.away && a == null) continue;
    out.push({ week: m.week, home: m.home, away: m.away, homePts: h, awayPts: a ?? null });
  }
  return out;
}

const slotKind = (slot: string): RosterPlayer['slot'] => (slot === 'IR' ? 'ir' : isStarting(slot) ? 'starter' : 'bench');

export function hostedSnapshot(
  i: HostedInput,
  pool: Map<string, PoolPlayer>,
  week: number,
  stats: GameStat[],
  rules: ScoringRules,
  now = Date.now()
): LeagueSnapshot {
  const table = standings(
    i.teams.map((t) => t.id),
    weekResults(i.matchups, i.weekScores, week)
  );
  const row = new Map(table.map((r) => [r.teamId, r]));
  const played = table.some((r) => r.wins + r.losses + r.ties > 0);
  const teams: Team[] = i.teams.map((t) => {
    const r = row.get(t.id);
    return {
      id: t.id,
      name: t.name,
      owner: null,
      record: r ? { wins: r.wins, losses: r.losses, ties: r.ties } : null,
      pointsFor: r?.pointsFor ?? 0,
      pointsAgainst: r?.pointsAgainst ?? 0,
      rank: played && r ? r.rank : null,
    };
  });

  const weekBy = new Map(i.teams.map((t) => [t.id, teamWeek(t.id, i.log, stats, rules)]));
  const rosters: Roster[] = i.teams.map((t) => {
    const mine = i.roster.filter((r) => r.teamId === t.id);
    const pts = new Map((weekBy.get(t.id)?.players ?? []).map((p) => [p.playerId, p.points]));
    return {
      teamId: t.id,
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

  const matchups: Matchup[] = i.matchups
    .filter((m) => m.week === week)
    .map((m) => ({
      period: week,
      home: { teamId: m.home, points: weekBy.get(m.home)?.total ?? 0 },
      away: m.away ? { teamId: m.away, points: weekBy.get(m.away)?.total ?? 0 } : null,
    }));

  return {
    league: asLeague({ ...i, teamCount: i.teams.length }),
    teams,
    rosters,
    matchups,
    period: i.matchups.length ? week : null,
    fetchedAt: now,
  };
}
