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
  mlb: [
    { slot: 'C', note: 'Catcher', max: 2 },
    { slot: '1B', note: 'First base', max: 2 },
    { slot: '2B', note: 'Second base', max: 2 },
    { slot: '3B', note: 'Third base', max: 2 },
    { slot: 'SS', note: 'Shortstop', max: 2 },
    { slot: 'CI', note: '1B or 3B', max: 2 },
    { slot: 'MI', note: '2B or SS', max: 2 },
    { slot: 'OF', note: 'Outfield', max: 6 },
    { slot: 'UTIL', note: 'Any hitter', max: 4 },
    { slot: 'SP', note: 'Starting pitcher', max: 7 },
    { slot: 'RP', note: 'Relief pitcher', max: 7 },
    { slot: 'P', note: 'Any pitcher', max: 9 },
  ],
  nba: [
    { slot: 'PG', note: 'Point guard', max: 2 },
    { slot: 'SG', note: 'Shooting guard', max: 2 },
    { slot: 'G', note: 'PG or SG', max: 3 },
    { slot: 'SF', note: 'Small forward', max: 2 },
    { slot: 'PF', note: 'Power forward', max: 2 },
    { slot: 'F', note: 'SF or PF', max: 3 },
    { slot: 'C', note: 'Center', max: 3 },
    { slot: 'UTIL', note: 'Anyone', max: 4 },
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
    // Regular season + 3 playoff rounds fits each sport's calendar (NFL: 14 + 3 = week 17).
    weeks: SEASON_WEEKS[sport],
    playoffTeams: 4,
    waivers: { type: 'rolling', days: 2, budget: 100 },
    trades: { review: 'commissioner', reviewHours: 24, vetoVotes: 4, deadline: null },
    maxAddsPerWeek: 0,
    divisions: [],
    keepers: 0,
    draftRounds: null,
    auctionBudget: 200,
    bidSeconds: 20,
  };
}

/** Regular-season weeks that leave room for 3 playoff rounds. */
const SEASON_WEEKS: Record<HostedSport, number> = { nhl: 21, nfl: 14, mlb: 22, nba: 19 };

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
  if (sport === 'mlb' && !(s.slots.SP || s.slots.RP || s.slots.P)) out.push('Baseball lineups need at least one pitcher spot.');
  if (s.divisions.length === 1 || s.divisions.length > 4) out.push('Use 2 to 4 divisions, or none.');
  if (s.divisions.some((d) => !d.trim())) out.push('Every division needs a name.');
  if (s.keepers < 0 || s.keepers > n + s.bench) out.push('Keepers must be 0 up to the roster size.');
  if (s.draftRounds != null && (s.draftRounds < 1 || s.draftRounds > n + s.bench)) out.push('Draft rounds must be 1 up to the roster size.');
  if (s.draftType === 'auction' && (s.auctionBudget < n + s.bench || s.auctionBudget > 1000)) {
    out.push(`Auction budget must be at least $1 per roster spot (${n + s.bench}) and at most $1000.`);
  }
  if (s.draftType === 'auction' && (s.bidSeconds < 5 || s.bidSeconds > 120)) out.push('Bid clock must be 5 to 120 seconds.');
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
  if (s.trades.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(s.trades.deadline) || Number.isNaN(Date.parse(s.trades.deadline)))) {
    out.push('Trade deadline must be a date like 2027-02-15, or empty.');
  }
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
