/**
 * 128BIT LEAGUES as a provider, so hosted leagues sync and show next to
 * Sleeper, Yahoo and the rest.
 */
import type { HostedSport } from '@/src/leagues/scoring';
import { asLeague, hostedSnapshot } from '@/src/leagues/snapshot';
import type { PoolPlayer } from '@/src/leagues/types';
import { teamWeek } from '@/src/leagues/season';
import type { ProviderAdapter } from '@/src/providers/types';
import type { HostedConn } from './client';
import { clientFor, must } from './client';
import { leagueBundle, recordWeek, type LeagueBundle } from './data';
import { currentWeek, playerPool, weekStats } from './stats';

/** Finished weeks nobody has recorded yet get worked out here — a few per refresh, oldest first. */
const BACKFILL_PER_REFRESH = 3;

export async function poolMap(sport: HostedSport, season: string): Promise<Map<string, PoolPlayer>> {
  return new Map((await playerPool(sport, season)).map((p) => [p.id, p]));
}

export async function liveWeek(b: LeagueBundle): Promise<number> {
  if (!b.league.seasonStart) return 1;
  return Math.min(Math.max(1, await currentWeek(b.league.sport, b.league.seasonStart)), b.league.settings.weeks + 1);
}

async function backfill(b: LeagueBundle, week: number, pool: Map<string, PoolPlayer>): Promise<void> {
  if (!b.league.seasonStart) return;
  const done = new Set(b.weekScores.map((w) => w.week));
  const missing = [...new Set(b.matchups.map((m) => m.week))].filter((w) => w < week && !done.has(w)).sort((a, b2) => a - b2);
  const ids = new Set(b.roster.map((r) => r.playerId).concat(b.log.map((l) => l.playerId)));
  for (const w of missing.slice(0, BACKFILL_PER_REFRESH)) {
    const ws = await weekStats(b.league.sport, b.league.season, b.league.seasonStart, w, pool, ids);
    const scores: Record<string, number> = {};
    for (const t of b.teams) scores[t.id] = teamWeek(t.id, b.log, ws.stats, b.league.settings.scoring).total;
    await recordWeek(b.league.id, w, scores);
    for (const t of b.teams) b.weekScores.push({ week: w, teamId: t.id, points: scores[t.id] });
  }
}

export const hostedAdapter: ProviderAdapter<HostedConn> = {
  id: 'bit128',
  label: '128BIT LEAGUES',
  stability: 'official',
  sports: ['nhl', 'nfl'],

  async listLeagues(conn) {
    const sb = clientFor(conn);
    const { data: s } = await sb.auth.getSession();
    const me = s.session?.user.id;
    if (!me) return [];
    const mine = (must(await sb.from('teams').select('id, league_id, owner')) ?? []) as { id: string; league_id: string; owner: string }[];
    const leagues = (must(await sb.from('leagues').select('id, name, sport, season, status')) ?? []) as {
      id: string;
      name: string;
      sport: 'nhl' | 'nfl';
      season: string;
      status: string;
    }[];
    return leagues.map((l) =>
      asLeague({
        league: l,
        myTeamId: mine.find((t) => t.league_id === l.id && t.owner === me)?.id ?? null,
        teamCount: mine.filter((t) => t.league_id === l.id).length,
      })
    );
  },

  async snapshot(conn, league) {
    clientFor(conn);
    const b = await leagueBundle(league.id);
    const pool = await poolMap(b.league.sport, b.league.season);
    if (b.league.status === 'setup' || b.league.status === 'drafting' || !b.league.seasonStart) {
      return hostedSnapshot(b, pool, 1, [], b.league.settings.scoring);
    }
    const week = await liveWeek(b);
    await backfill(b, week, pool).catch(() => undefined);
    const ids = new Set(b.roster.map((r) => r.playerId));
    const shown = Math.min(week, b.league.settings.weeks);
    const ws = await weekStats(b.league.sport, b.league.season, b.league.seasonStart, shown, pool, ids);
    return hostedSnapshot(b, pool, shown, ws.stats, b.league.settings.scoring);
  },
};
