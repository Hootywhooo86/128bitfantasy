/**
 * What the user chose about their leagues: which ones to show, and which team
 * is theirs where the provider could not say.
 *
 * Pure — storage lives in lib/storage/prefs.ts.
 */
import type { League, LeagueSnapshot } from './models';

export type LeaguePrefs = {
  /** League keys hidden from Home. */
  hidden: string[];
  /** League key → team id the user picked as theirs. Wins over the provider's guess. */
  myTeam: Record<string, string>;
};

export const EMPTY_PREFS: LeaguePrefs = { hidden: [], myTeam: {} };

export const leagueKey = (l: Pick<League, 'provider' | 'id'>) => `${l.provider}:${l.id}`;

export function withMyTeam<T extends League>(l: T, p: LeaguePrefs): T {
  const picked = p.myTeam[leagueKey(l)];
  return picked ? { ...l, myTeamId: picked } : l;
}

export function snapshotWithPrefs(s: LeagueSnapshot, p: LeaguePrefs): LeagueSnapshot {
  const league = withMyTeam(s.league, p);
  return league === s.league ? s : { ...s, league };
}

/**
 * Home shows a league only when it is a team the user is in — we know which
 * team is theirs — and they have not hidden it.
 */
export function visibleOnHome(leagues: League[], p: LeaguePrefs): League[] {
  const hidden = new Set(p.hidden);
  return leagues.map((l) => withMyTeam(l, p)).filter((l) => l.myTeamId && !hidden.has(leagueKey(l)));
}

/** Leagues we found but cannot place the user in — they need to pick their team. */
export function needsTeamPick(leagues: League[], p: LeaguePrefs): League[] {
  const hidden = new Set(p.hidden);
  return leagues.map((l) => withMyTeam(l, p)).filter((l) => !l.myTeamId && !hidden.has(leagueKey(l)));
}

export function toggleHidden(p: LeaguePrefs, key: string, hide: boolean): LeaguePrefs {
  const set = new Set(p.hidden);
  if (hide) set.add(key);
  else set.delete(key);
  return { ...p, hidden: [...set] };
}

export function pickTeam(p: LeaguePrefs, key: string, teamId: string | null): LeaguePrefs {
  const myTeam = { ...p.myTeam };
  if (teamId) myTeam[key] = teamId;
  else delete myTeam[key];
  return { ...p, myTeam };
}
