/**
 * 128bit feed events, derived by comparing two snapshots of the same league.
 *
 * The 128bit family shares one event feed: 128bitlife turns these into quests
 * and XP ("win a matchup", "fix your lineup before kickoff"). Events are
 * facts that changed between two reads — never guesses — and carry a stable
 * id, so seeing the same change twice produces the same event once.
 *
 * Wins come from the record changing, not from comparing scores: a score read
 * mid-game is not a result, but a win added to the record is.
 */
import { lineupIssues, type LineupIssue } from './lineup-check';
import type { League, LeagueSnapshot, Team } from './models';
import { leagueKey } from './prefs';

export type FantasyEventType = 'matchup.won' | 'matchup.lost' | 'matchup.tied' | 'lineup.problem' | 'lineup.fixed';

export type FantasyEvent = {
  /** Stable: the same change always produces the same id. */
  id: string;
  type: FantasyEventType;
  /** epoch ms when this device noticed it */
  at: number;
  app: '128bitfantasy';
  league: Pick<League, 'provider' | 'id' | 'name' | 'sport' | 'season'>;
  teamId: string;
  period: number | null;
  title: string;
  body: string;
};

function leagueRef(l: League): FantasyEvent['league'] {
  return { provider: l.provider, id: l.id, name: l.name, sport: l.sport, season: l.season };
}

const issueId = (i: LineupIssue) => `${i.slot}:${i.player?.id ?? 'empty'}:${i.severity}`;

export function deriveEvents(prev: LeagueSnapshot | null, next: LeagueSnapshot, now = Date.now()): FantasyEvent[] {
  const me = next.league.myTeamId;
  if (!me) return [];
  const key = leagueKey(next.league);
  const base = { at: now, app: '128bitfantasy' as const, league: leagueRef(next.league), teamId: me };
  const out: FantasyEvent[] = [];
  const myTeam = (s: LeagueSnapshot | null): Team | undefined => s?.teams.find((t) => t.id === me);

  // Results: the record moved.
  const before = myTeam(prev)?.record;
  const after = myTeam(next)?.record;
  if (before && after) {
    const period = prev?.period ?? next.period;
    const games = before.wins + before.losses + before.ties;
    const oppId = prev?.matchups.find((m) => m.home.teamId === me || m.away?.teamId === me);
    const opp = oppId ? (oppId.home.teamId === me ? oppId.away?.teamId : oppId.home.teamId) : null;
    const oppName = opp ? prev?.teams.find((t) => t.id === opp)?.name : null;
    const vs = oppName ? ` vs ${oppName}` : '';
    const add = (type: FantasyEventType, verb: string) =>
      out.push({
        ...base,
        id: `${key}:${me}:${type}:g${games + 1}`,
        type,
        period,
        title: `${verb}${period ? ` week ${period}` : ''}${vs}`,
        body: `${next.league.name} · now ${after.wins}-${after.losses}${after.ties ? `-${after.ties}` : ''}`,
      });
    if (after.wins > before.wins) add('matchup.won', 'You won');
    else if (after.losses > before.losses) add('matchup.lost', 'You lost');
    else if (after.ties > before.ties) add('matchup.tied', 'You tied');
  }

  // Lineup: new problems, and problems that went away.
  const roster = (s: LeagueSnapshot | null) => s?.rosters.find((r) => r.teamId === me);
  const was = new Map(lineupIssues(roster(prev), next.league.sport).filter((i) => i.severity === 'bad').map((i) => [issueId(i), i]));
  const nowIssues = lineupIssues(roster(next), next.league.sport).filter((i) => i.severity === 'bad');
  for (const i of nowIssues) {
    if (was.has(issueId(i))) continue;
    out.push({
      ...base,
      id: `${key}:${me}:lineup:${next.period ?? 'x'}:${issueId(i)}`,
      type: 'lineup.problem',
      period: next.period,
      title: `${i.message} — ${i.slot}`,
      body: i.options.length
        ? `${next.league.name}: swap in ${i.options[0].name}${i.options.length > 1 ? ` or ${i.options.length - 1} other` : ''}`
        : `${next.league.name}: no healthy bench player fits — check waivers`,
    });
  }
  if (prev && was.size > 0 && nowIssues.length === 0) {
    out.push({
      ...base,
      id: `${key}:${me}:fixed:${next.period ?? 'x'}:${[...was.keys()].sort().join('|')}`,
      type: 'lineup.fixed',
      period: next.period,
      title: 'Lineup fixed',
      body: `${next.league.name}: every starter is healthy again`,
    });
  }
  return out;
}

/** Which events deserve a phone notification. A fix is good news, but not worth a buzz. */
export function shouldNotify(e: FantasyEvent): boolean {
  return e.type !== 'lineup.fixed';
}
