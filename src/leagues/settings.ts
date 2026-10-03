/**
 * League settings: defaults per sport, the choices the settings screen
 * offers, and the checks a league must pass before it's created or changed.
 */
import { CATEGORIES, DEFAULT_CATEGORIES } from './categories';
import { DEFAULT_SCORING, type HostedSport } from './scoring';
import { playoffRounds } from './standings';
import { DEFAULT_BENCH, DEFAULT_SLOTS, isH2H, usesCategories, type LeagueSettings } from './types';

/** Every slot a league can have, in lineup order. */
export const SLOT_CHOICES: Record<HostedSport, { slot: string; note: string; max: number }[]> = {
  nhl: [
    { slot: 'C', note: 'Center', max: 4 },
    { slot: 'LW', note: 'Left wing', max: 4 },
    { slot: 'RW', note: 'Right wing', max: 4 },
    { slot: 'F', note: 'Any forward', max: 4 },
    { slot: 'D', note: 'Defense', max: 6 },
    { slot: 'UTIL', note: 'Any skater', max: 4 },
    { slot: 'G', note: 'Goalie', max: 4 },
  ],
  nfl: [
    { slot: 'QB', note: 'Quarterback', max: 3 },
    { slot: 'RB', note: 'Running back', max: 4 },
    { slot: 'WR', note: 'Wide receiver', max: 5 },
    { slot: 'TE', note: 'Tight end', max: 3 },
    { slot: 'FLEX', note: 'RB / WR / TE', max: 4 },
    { slot: 'SUPERFLEX', note: 'QB / RB / WR / TE', max: 2 },
    { slot: 'K', note: 'Kicker', max: 2 },
    { slot: 'DEF', note: 'Team defense', max: 2 },
  ],
};

export function defaultSettings(sport: HostedSport): LeagueSettings {
  return {
    format: 'h2h_points',
    slots: { ...DEFAULT_SLOTS[sport] },
    bench: DEFAULT_BENCH[sport],
    ir: sport === 'nhl' ? 2 : 1,
    scoring: { ...DEFAULT_SCORING[sport] },
    categories: [...DEFAULT_CATEGORIES[sport]],
    draftType: 'snake',
    pickSeconds: 90,
    // NHL regular season is ~25 weeks: 21 + 3 playoff rounds fits. NFL: 14 + 3 fits week 17.
    weeks: sport === 'nhl' ? 21 : 14,
    playoffTeams: 4,
    waivers: { type: 'rolling', days: 2, budget: 100 },
    trades: { review: 'commissioner', reviewHours: 24, vetoVotes: 4, deadline: null },
    maxAddsPerWeek: 0,
  };
}

/**
 * Older leagues (and anything partly filled in) get every missing setting
 * from the defaults, so no screen has to guard each field.
 */
export function withDefaults(sport: HostedSport, s: Partial<LeagueSettings> | null | undefined): LeagueSettings {
  const d = defaultSettings(sport);
  const x = s ?? {};
  return {
    ...d,
    ...x,
    slots: x.slots ?? d.slots,
    scoring: x.scoring ?? d.scoring,
    categories: x.categories ?? d.categories,
    waivers: { ...d.waivers, ...(x.waivers ?? {}) },
    trades: { ...d.trades, ...(x.trades ?? {}) },
    // A league made before IR / playoffs existed keeps playing without them.
    ir: x.ir ?? (s ? 0 : d.ir),
    playoffTeams: x.playoffTeams ?? (s ? 0 : d.playoffTeams),
  };
}

export const PICK_CLOCKS = [30, 60, 90, 120, 300];
export const PLAYOFF_CHOICES = [0, 2, 4, 6, 8];

/** The last week of the season, playoffs included. */
export function lastWeek(s: Pick<LeagueSettings, 'format' | 'weeks' | 'playoffTeams'>, teams: number): number {
  return s.weeks + (isH2H(s.format) ? playoffRounds(Math.min(s.playoffTeams, teams)) : 0);
}

export function starters(s: Pick<LeagueSettings, 'slots'>): number {
  return Object.values(s.slots).reduce((a, b) => a + b, 0);
}

/** Every problem with a settings object, as sentences. Empty = fine. */
export function settingsProblems(sport: HostedSport, s: LeagueSettings, maxTeams: number): string[] {
  const out: string[] = [];
  const n = starters(s);
  if (n < 1) out.push('The lineup needs at least one starting spot.');
  if (n + s.bench > 30) out.push('Rosters top out at 30 players (starters + bench).');
  if (s.bench < 0 || s.bench > 15) out.push('Bench must be 0 to 15.');
  if (s.ir < 0 || s.ir > 5) out.push('IR must be 0 to 5.');
  if (sport === 'nhl' && !s.slots.G) out.push('Hockey lineups need at least one G.');
  if (s.weeks < 1 || s.weeks > 26) out.push('Regular season must be 1 to 26 weeks.');
  if (isH2H(s.format) && s.playoffTeams > maxTeams) out.push(`Playoffs can't have more teams (${s.playoffTeams}) than the league (${maxTeams}).`);
  if (isH2H(s.format) && s.playoffTeams === 1) out.push('Playoffs need 0 or at least 2 teams.');
  if (usesCategories(s.format)) {
    const known = new Set(CATEGORIES[sport].map((c) => c.key));
    if (s.categories.filter((c) => known.has(c)).length < 3) out.push('Pick at least 3 categories.');
  }
  if (s.waivers.type === 'faab' && (s.waivers.budget < 1 || s.waivers.budget > 1000)) out.push('FAAB budget must be 1 to 1000.');
  if (s.waivers.days < 0 || s.waivers.days > 7) out.push('Waiver period must be 0 to 7 days.');
  if (s.trades.reviewHours < 0 || s.trades.reviewHours > 72) out.push('Trade review must be 0 to 72 hours.');
  if (s.trades.review === 'vote' && s.trades.vetoVotes < 1) out.push('Vetoes need at least 1 vote.');
  for (const [k, v] of Object.entries(s.scoring)) if (!Number.isFinite(v)) out.push(`Scoring for ${k} isn't a number.`);
  return out;
}

/** One-line summary for cards and invites. */
export function settingsSummary(sport: HostedSport, s: LeagueSettings): string {
  const slots = Object.entries(s.slots)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => (n > 1 ? `${n} ${k}` : k))
    .join(' · ');
  return `${slots} · ${s.bench} BN${s.ir ? ` · ${s.ir} IR` : ''}`;
}
