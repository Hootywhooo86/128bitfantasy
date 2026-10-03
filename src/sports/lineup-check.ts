/**
 * The lineup check: is anyone in your starting lineup not going to play?
 *
 * Works without AI and without projections — only what the provider reports.
 * That's why it never says who is *best* to swap in, only who on your bench
 * is healthy and allowed in that slot. Picking between them is Coaches
 * Corner's job.
 */
import type { Roster, RosterPlayer, Sport } from './models';

export type InjuryLevel = 'out' | 'doubtful' | 'questionable';

/**
 * Every provider spells injury status differently: Sleeper "Out", ESPN
 * "INJURY RESERVE", Yahoo "O" / "Injured Reserve", MFL "IR", Fleaflicker
 * "Questionable". One scale for all of them. Unknown statuses are null, not
 * a guess.
 */
export function injuryLevel(status: string | null | undefined): InjuryLevel | null {
  if (!status) return null;
  const s = status.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/^(o|out|ir|ir\+|il|il\d+|dl|na|pup|nfi|cov|covid|sus|susp|suspended|suspension|not active|inactive|holdout|injured reserve|injury reserve|reserve)\b/.test(s)) {
    return 'out';
  }
  if (/^(d|doubtful)\b/.test(s)) return 'doubtful';
  if (/^(q|questionable|dtd|day to day|gtd|game time decision)\b/.test(s)) return 'questionable';
  return null;
}

/** Football only: in hockey "D" is a defenseman, not a team defense. */
const NFL_ALIAS: Record<string, string> = { DST: 'DEF', 'D/ST': 'DEF', D: 'DEF', PK: 'K' };
const norm = (p: string, sport: Sport) => {
  const u = p.toUpperCase();
  return sport === 'nfl' ? NFL_ALIAS[u] ?? u : u;
};

/** Slots that take more than their own name, by sport. */
const FLEX: Record<Sport, Record<string, string[]>> = {
  nfl: {
    FLEX: ['RB', 'WR', 'TE'],
    'W/R/T': ['RB', 'WR', 'TE'],
    WRT: ['RB', 'WR', 'TE'],
    'RB/WR/TE': ['RB', 'WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    SF: ['QB', 'RB', 'WR', 'TE'],
    OP: ['QB', 'RB', 'WR', 'TE'],
    'Q/W/R/T': ['QB', 'RB', 'WR', 'TE'],
    REC_FLEX: ['WR', 'TE'],
    'WR/TE': ['WR', 'TE'],
    'W/T': ['WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
    'RB/WR': ['RB', 'WR'],
    'W/R': ['RB', 'WR'],
    IDP_FLEX: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'],
  },
  nba: { G: ['PG', 'SG'], F: ['SF', 'PF'], UTIL: ['PG', 'SG', 'SF', 'PF', 'C'] },
  nhl: { F: ['C', 'LW', 'RW'], W: ['LW', 'RW'], UTIL: ['C', 'LW', 'RW', 'D'] },
  mlb: {
    UTIL: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH'],
    OF: ['OF', 'LF', 'CF', 'RF'],
    CI: ['1B', '3B'],
    MI: ['2B', 'SS'],
    P: ['SP', 'RP', 'P'],
  },
};

/** "PG,SG" / "SG/SF" / "WR" → ["PG","SG"] etc. */
function positions(p: string | null, sport: Sport): string[] {
  // "D/ST" is one position, not two.
  if (p && sport === 'nfl' && /^d\/st$/i.test(p.trim())) return ['DEF'];
  return p ? p.split(/[,/]/).map((x) => norm(x.trim(), sport)).filter(Boolean) : [];
}

/** Can a player with position `pos` legally start in `slot`? */
export function slotAccepts(slot: string, pos: string | null, sport: Sport): boolean {
  const have = positions(pos, sport);
  if (!have.length) return false;
  const key = slot.toUpperCase();
  const allowed = FLEX[sport][key] ?? (sport === 'nfl' && key === 'D/ST' ? ['DEF'] : key.split('/').map((k) => norm(k, sport)));
  return have.some((p) => allowed.includes(p));
}

export type LineupIssue = {
  severity: 'bad' | 'warn';
  /** The starter with the problem, or null for an empty slot. */
  player: RosterPlayer | null;
  slot: string;
  message: string;
  /** Healthy bench players allowed in that slot. Not ranked. */
  options: RosterPlayer[];
};

export function lineupIssues(roster: Roster | undefined, sport: Sport): LineupIssue[] {
  if (!roster) return [];
  const healthyBench = roster.players.filter((p) => p.slot === 'bench' && injuryLevel(p.injury) == null);
  const optionsFor = (slot: string) => healthyBench.filter((b) => slotAccepts(slot, b.position, sport)).slice(0, 3);
  const issues: LineupIssue[] = [];

  for (const slot of roster.emptySlots ?? []) {
    issues.push({ severity: 'bad', player: null, slot, message: `Empty ${slot} slot`, options: optionsFor(slot) });
  }
  for (const p of roster.players) {
    if (p.slot !== 'starter') continue;
    const level = injuryLevel(p.injury);
    if (!level) continue;
    const slot = p.lineupSlot ?? p.position ?? '';
    issues.push({
      severity: level === 'questionable' ? 'warn' : 'bad',
      player: p,
      slot,
      message: `${p.name} is ${level === 'out' ? (p.injury ?? 'OUT').toUpperCase() : level.toUpperCase()}`,
      options: optionsFor(slot),
    });
  }
  // Worst first.
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'bad' ? -1 : 1));
}

/** A one-line summary for a card: "2 lineup problems", or null if clean. */
export function issueSummary(issues: LineupIssue[]): { text: string; severity: 'bad' | 'warn' } | null {
  if (!issues.length) return null;
  const bad = issues.filter((i) => i.severity === 'bad').length;
  if (bad) return { text: `${bad} LINEUP PROBLEM${bad === 1 ? '' : 'S'}`, severity: 'bad' };
  return { text: `${issues.length} QUESTIONABLE STARTER${issues.length === 1 ? '' : 'S'}`, severity: 'warn' };
}
