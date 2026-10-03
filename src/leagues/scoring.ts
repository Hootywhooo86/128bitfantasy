/**
 * 128BIT LEAGUES scoring: a stat line times a points table.
 *
 * A stat line is whatever the stat source counted, keyed by our own stat
 * names (NHL) or Sleeper's (NFL). The rules map the same keys to points, so a
 * commissioner can change any value without touching code.
 */
export type HostedSport = 'nhl' | 'nfl';

export type StatLine = Record<string, number>;
export type ScoringRules = Record<string, number>;

export type StatLabel = { key: string; label: string };

/**
 * Hockey, head-to-head points. Close to the common Yahoo/ESPN points
 * defaults: goals and assists carry it, peripherals keep grinders useful.
 */
export const NHL_SCORING: ScoringRules = {
  goals: 3,
  assists: 2,
  ppGoals: 1,
  shots: 0.4,
  hits: 0.2,
  blockedShots: 0.4,
  plusMinus: 0.5,
  // Goalies
  wins: 4,
  saves: 0.2,
  goalsAgainst: -1,
  shutouts: 3,
};

/**
 * Football, full PPR — Sleeper's own default table, so a week here scores
 * the same as it would on Sleeper. Keys are Sleeper's stat names.
 */
export const NFL_SCORING: ScoringRules = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  fum_lost: -2,
  // Kicker
  fgm_0_19: 3,
  fgm_20_29: 3,
  fgm_30_39: 3,
  fgm_40_49: 4,
  fgm_50p: 5,
  xpm: 1,
  fgmiss: -1,
  xpmiss: -1,
  // Team defense
  sack: 1,
  int: 2,
  fum_rec: 2,
  ff: 1,
  def_td: 6,
  def_st_td: 6,
  def_st_ff: 1,
  def_st_fum_rec: 1,
  blk_kick: 2,
  safe: 2,
  pts_allow_0: 10,
  pts_allow_1_6: 7,
  pts_allow_7_13: 4,
  pts_allow_14_20: 1,
  pts_allow_21_27: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
};

export const DEFAULT_SCORING: Record<HostedSport, ScoringRules> = { nhl: NHL_SCORING, nfl: NFL_SCORING };

/** Names for the scoring-settings screen; anything not listed shows its key. */
export const STAT_LABELS: Record<string, string> = {
  goals: 'Goal',
  assists: 'Assist',
  ppGoals: 'Power-play goal (bonus)',
  shots: 'Shot on goal',
  hits: 'Hit',
  blockedShots: 'Blocked shot',
  plusMinus: 'Plus/minus',
  wins: 'Goalie win',
  saves: 'Save',
  goalsAgainst: 'Goal against',
  shutouts: 'Shutout',
  pass_yd: 'Passing yard',
  pass_td: 'Passing TD',
  pass_int: 'Interception thrown',
  rush_yd: 'Rushing yard',
  rush_td: 'Rushing TD',
  rec: 'Reception',
  rec_yd: 'Receiving yard',
  rec_td: 'Receiving TD',
  fum_lost: 'Fumble lost',
  xpm: 'Extra point',
  sack: 'Sack',
  int: 'Interception',
  fum_rec: 'Fumble recovery',
  def_td: 'Defensive TD',
  safe: 'Safety',
};

/** Fantasy points for one stat line, to the hundredth. Stats the rules don't mention score 0. */
export function fantasyPoints(line: StatLine, rules: ScoringRules): number {
  let total = 0;
  for (const [k, v] of Object.entries(line)) {
    const per = rules[k];
    if (per && Number.isFinite(v)) total += per * v;
  }
  return Math.round(total * 100) / 100;
}

/** Adds stat lines together — a week is the sum of its games. */
export function addLines(a: StatLine, b: StatLine): StatLine {
  const out: StatLine = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
