/**
 * MLB stats for hosted baseball leagues — MLB's own free Stats API, no key.
 *
 * statsapi.mlb.com/api/v1: schedule, 40-man rosters, live box scores, and
 * whole-league season totals (one call for hitters, one for pitchers).
 * Pure parsers here; lib/leagues/stats.ts does the requests.
 */
import { num } from '@/src/sports/models';
import type { StatLine } from './scoring';
import type { GameState } from './season';
import type { PoolPlayer } from './types';

export const MLB_API = 'https://statsapi.mlb.com/api/v1';

/** MLB position abbreviations → fantasy positions. Two-way players are both. */
export function mlbPosition(abbr: unknown, pitching?: { gamesStarted?: number; gamesPitched?: number }): string {
  switch (abbr) {
    case 'LF':
    case 'CF':
    case 'RF':
    case 'OF':
      return 'OF';
    case 'C':
    case '1B':
    case '2B':
    case '3B':
    case 'SS':
    case 'DH':
      return abbr;
    case 'TWP':
      return 'DH/SP';
    case 'P':
    case 'SP':
    case 'RP': {
      const gs = pitching?.gamesStarted ?? 0;
      const gp = pitching?.gamesPitched ?? 0;
      if (!gp) return abbr === 'P' ? 'SP/RP' : abbr;
      // Mostly starts → SP; mostly relief → RP; a real swingman is both.
      if (gs / gp >= 0.75) return 'SP';
      if (gs / gp <= 0.25) return 'RP';
      return 'SP/RP';
    }
    default:
      return 'UTIL';
  }
}

export function mlbGameState(abstract: unknown): GameState {
  if (abstract === 'Live') return 'live';
  if (abstract === 'Final') return 'final';
  return 'pre';
}

export type MlbGame = { id: string; start: string; state: GameState; home: string; away: string };

/** Games from /schedule?startDate&endDate. Regular season and postseason only. */
export function parseMlbSchedule(json: unknown, abbrById: Map<number, string>): MlbGame[] {
  const dates = ((json ?? {}) as { dates?: { games?: Record<string, unknown>[] }[] }).dates ?? [];
  const out: MlbGame[] = [];
  for (const d of dates) {
    for (const g of d.games ?? []) {
      if (!['R', 'F', 'D', 'L', 'W'].includes(String(g.gameType))) continue;
      const teams = g.teams as { home?: { team?: { id?: number } }; away?: { team?: { id?: number } } } | undefined;
      const home = abbrById.get(Number(teams?.home?.team?.id));
      const away = abbrById.get(Number(teams?.away?.team?.id));
      if (!home || !away) continue;
      const status = g.status as { abstractGameState?: string; detailedState?: string } | undefined;
      // Postponed games never start; leave them out so nobody waits on them.
      if (/Postponed|Cancelled/i.test(status?.detailedState ?? '')) continue;
      out.push({ id: String(g.gamePk), start: String(g.gameDate ?? ''), state: mlbGameState(status?.abstractGameState), home, away });
    }
  }
  return out;
}

export function abbrMap(teamsJson: unknown): Map<number, string> {
  const teams = ((teamsJson ?? {}) as { teams?: { id?: number; abbreviation?: string }[] }).teams ?? [];
  return new Map(teams.filter((t) => t.id && t.abbreviation).map((t) => [t.id!, t.abbreviation!]));
}

function battingLine(b: Record<string, unknown>): StatLine {
  const hits = num(b.hits) ?? 0;
  const doubles = num(b.doubles) ?? 0;
  const triples = num(b.triples) ?? 0;
  const homeRuns = num(b.homeRuns) ?? 0;
  return {
    atBats: num(b.atBats) ?? 0,
    hits,
    singles: hits - doubles - triples - homeRuns,
    doubles,
    triples,
    homeRuns,
    runs: num(b.runs) ?? 0,
    rbi: num(b.rbi) ?? 0,
    walks: num(b.baseOnBalls) ?? 0,
    hitByPitch: num(b.hitByPitch) ?? 0,
    stolenBases: num(b.stolenBases) ?? 0,
    caughtStealing: num(b.caughtStealing) ?? 0,
    strikeouts: num(b.strikeOuts) ?? 0,
  };
}

function pitchingLine(p: Record<string, unknown>, final: boolean): StatLine {
  const outs = num(p.outs) ?? 0;
  const er = num(p.earnedRuns) ?? 0;
  const started = (num(p.gamesStarted) ?? 0) > 0;
  return {
    outs,
    pitcherStrikeouts: num(p.strikeOuts) ?? 0,
    hitsAllowed: num(p.hits) ?? 0,
    walksAllowed: num(p.baseOnBalls) ?? 0,
    earnedRuns: er,
    wins: num(p.wins) ?? 0,
    losses: num(p.losses) ?? 0,
    saves: num(p.saves) ?? 0,
    holds: num(p.holds) ?? 0,
    // 6+ innings, 3 or fewer earned runs, as a starter — only once the game is over.
    qualityStarts: final && started && outs >= 18 && er <= 3 ? 1 : 0,
  };
}

const merge = (a: StatLine, b: StatLine): StatLine => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** Every player's line from /game/{pk}/boxscore (hitting and pitching, both for a two-way player). */
export function parseMlbBoxscore(json: unknown, final: boolean): Map<string, StatLine> {
  const out = new Map<string, StatLine>();
  const teams = ((json ?? {}) as { teams?: Record<string, { players?: Record<string, Record<string, unknown>> }> }).teams ?? {};
  for (const side of [teams.home, teams.away]) {
    for (const p of Object.values(side?.players ?? {})) {
      const id = (p.person as { id?: number } | undefined)?.id;
      const stats = (p.stats ?? {}) as { batting?: Record<string, unknown>; pitching?: Record<string, unknown> };
      if (!id) continue;
      let line: StatLine | null = null;
      // Only players who batted or pitched: bench players have empty stat objects.
      if (stats.batting && (num(stats.batting.plateAppearances) ?? 0) > 0) line = battingLine(stats.batting);
      if (stats.pitching && (num(stats.pitching.battersFaced) ?? 0) > 0) line = merge(line ?? {}, pitchingLine(stats.pitching, final));
      if (line) out.set(String(id), line);
    }
  }
  return out;
}

type Split = { player?: { id?: number; fullName?: string }; team?: { id?: number }; position?: { abbreviation?: string }; stat?: Record<string, unknown> };
const splits = (json: unknown): Split[] => ((json ?? {}) as { stats?: { splits?: Split[] }[] }).stats?.[0]?.splits ?? [];

/**
 * The draft pool: everyone on a 40-man roster, with last season's hitting
 * and pitching totals. Without rosters, last season's players at their last
 * teams.
 */
export function buildMlbPool(
  rosters: { team: string; json: unknown }[],
  hitting: unknown,
  pitching: unknown,
  abbrById: Map<number, string>
): PoolPlayer[] {
  const season = new Map<string, { line: StatLine; gp: number; pos?: string; name?: string; team?: string; pitch?: { gamesStarted: number; gamesPitched: number } }>();
  for (const s of splits(hitting)) {
    const id = String(s.player?.id ?? '');
    if (!id || !s.stat) continue;
    const prev = season.get(id);
    season.set(id, {
      ...prev,
      line: merge(prev?.line ?? {}, battingLine(s.stat)),
      gp: Math.max(prev?.gp ?? 0, num(s.stat.gamesPlayed) ?? 0),
      pos: s.position?.abbreviation,
      name: s.player?.fullName,
      team: abbrById.get(Number(s.team?.id)),
    });
  }
  for (const s of splits(pitching)) {
    const id = String(s.player?.id ?? '');
    if (!id || !s.stat) continue;
    const prev = season.get(id);
    const pitch = { gamesStarted: num(s.stat.gamesStarted) ?? 0, gamesPitched: num(s.stat.gamesPitched) ?? num(s.stat.gamesPlayed) ?? 0 };
    // Season totals know the game count, not which starts were quality ones; leave QS at 0.
    const line = pitchingLine({ ...s.stat, gamesStarted: 0 }, false);
    season.set(id, {
      ...prev,
      line: merge(prev?.line ?? {}, line),
      gp: Math.max(prev?.gp ?? 0, pitch.gamesPitched),
      // A two-way player is both; a position player's mop-up inning isn't.
      pos:
        s.position?.abbreviation === 'TWP' || (prev?.pos && prev.pos !== 'P' && pitch.gamesPitched >= 5) ? 'TWP' : (prev?.pos ?? 'P'),
      name: prev?.name ?? s.player?.fullName,
      team: prev?.team ?? abbrById.get(Number(s.team?.id)),
      pitch,
    });
  }

  const out: PoolPlayer[] = [];
  const seen = new Set<string>();
  if (rosters.length) {
    for (const { team, json } of rosters) {
      for (const r of ((json ?? {}) as { roster?: { person?: { id?: number; fullName?: string }; position?: { abbreviation?: string } }[] }).roster ?? []) {
        const id = String(r.person?.id ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const s = season.get(id);
        out.push({
          id,
          name: r.person?.fullName ?? s?.name ?? id,
          position: mlbPosition(r.position?.abbreviation, s?.pitch),
          team,
          seasonLine: s?.line ?? {},
          gamesPlayed: s?.gp ?? 0,
        });
      }
    }
    return out;
  }
  for (const [id, s] of season) {
    out.push({ id, name: s.name ?? id, position: mlbPosition(s.pos, s.pitch), team: s.team ?? null, seasonLine: s.line, gamesPlayed: s.gp });
  }
  return out;
}
