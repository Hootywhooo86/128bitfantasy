/**
 * Per-player extras on top of what the league provider sends: a short injury
 * tag (Q, D, O, IR…), the injury itself and practice status, a projection,
 * and whether there is fresh news.
 *
 * Sources, all public and read-only:
 * - Injury detail (NFL): Sleeper's player catalog — body part, notes, practice.
 * - Projections (NFL): Sleeper's weekly projections, matched to the league's
 *   scoring (PPR / half / standard). ESPN leagues use ESPN's own projection,
 *   which comes with the roster and already uses the league's scoring.
 * - News (all sports): ESPN's fantasy player news (Rotowire blurbs). The
 *   player list carries a last-news date, so the scroll icon needs no extra
 *   call; the stories load when a player is opened.
 *
 * Players from other providers are matched to Sleeper / ESPN by name (and
 * team, where it helps). A name that matches two players is left unmatched —
 * no news beats someone else's news.
 *
 * Pure: data in, insights out.
 */
import { injuryLevel, type InjuryLevel } from './lineup-check';
import type { League, RosterPlayer, Sport } from './models';

/** "D.K. Metcalf Jr." → "dk metcalf". */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The two-to-three letter tag shown beside a name. Null when healthy or unknown. */
export function injuryTag(status: string | null | undefined): string | null {
  if (!status) return null;
  const s = status.trim().toUpperCase().replace(/[_-]+/g, ' ');
  if (/^(Q|QUESTIONABLE)\b/.test(s)) return 'Q';
  if (/^(D|DOUBTFUL)\b/.test(s)) return 'D';
  if (/^(O|OUT)\b/.test(s)) return 'O';
  if (/^(IR|INJURED RESERVE|INJURY RESERVE)\b/.test(s)) return 'IR';
  if (/^(IL|IL\d+|DL)\b/.test(s)) return s.split(' ')[0];
  if (/^(SUS|SUSP|SUSPENDED|SUSPENSION)\b/.test(s)) return 'SUS';
  if (/^PUP\b/.test(s)) return 'PUP';
  if (/^NFI\b/.test(s)) return 'NFI';
  if (/^(DTD|DAY TO DAY|GTD)\b/.test(s)) return 'DTD';
  if (/^(NA|NOT ACTIVE|INACTIVE)\b/.test(s)) return 'NA';
  if (/^(COV|COVID)/.test(s)) return 'COV';
  if (/^(ACTIVE|HEALTHY|NORMAL|PROBABLE)\b/.test(s)) return null;
  return s.slice(0, 3);
}

/** Sleeper catalog fields the insights read. */
export type SleeperInfo = {
  full_name?: string | null;
  position?: string | null;
  team?: string | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  practice_participation?: string | null;
  espn_id?: string | number | null;
};

/** Sleeper projections for one week, by Sleeper player id. */
export type Projections = Record<string, { ppr?: number; half?: number; std?: number }>;

/** ESPN's public player list, one row per player. */
export type EspnPlayer = { id: number; fullName: string; proTeamId?: number; lastNewsDate?: number };

export type EspnIndex = {
  byName: Map<string, EspnPlayer[]>;
  byId: Map<string, EspnPlayer>;
};

export function buildEspnIndex(list: EspnPlayer[]): EspnIndex {
  const byName = new Map<string, EspnPlayer[]>();
  const byId = new Map<string, EspnPlayer>();
  for (const p of list) {
    byId.set(String(p.id), p);
    const k = normName(p.fullName);
    const arr = byName.get(k) ?? [];
    arr.push(p);
    byName.set(k, arr);
  }
  return { byName, byId };
}

export type SleeperIndex = { byId: Record<string, SleeperInfo>; byName: Map<string, string[]> };

export function buildSleeperIndex(catalog: Record<string, SleeperInfo>): SleeperIndex {
  const byName = new Map<string, string[]>();
  for (const [id, p] of Object.entries(catalog)) {
    if (!p.full_name) continue;
    const k = normName(p.full_name);
    const arr = byName.get(k) ?? [];
    arr.push(id);
    byName.set(k, arr);
  }
  return { byId: catalog, byName };
}

/** The Sleeper id for a rostered player: native on Sleeper, by name (and team) elsewhere. */
export function sleeperIdFor(p: RosterPlayer, league: League, idx: SleeperIndex | null): string | null {
  if (!idx) return null;
  if (league.provider === 'sleeper') return idx.byId[p.id] ? p.id : null;
  const ids = idx.byName.get(normName(p.name)) ?? [];
  if (ids.length === 1) return ids[0];
  const sameTeam = ids.filter((id) => p.proTeam && idx.byId[id]?.team?.toUpperCase() === p.proTeam.toUpperCase());
  return sameTeam.length === 1 ? sameTeam[0] : null;
}

/** The ESPN id: native on ESPN, from Sleeper's cross-reference for NFL, else by unique name. */
export function espnIdFor(
  p: RosterPlayer,
  league: League,
  espn: EspnIndex | null,
  sleeperInfo: SleeperInfo | null
): string | null {
  if (league.provider === 'espn') return p.id;
  if (sleeperInfo?.espn_id != null && String(sleeperInfo.espn_id) !== '') return String(sleeperInfo.espn_id);
  if (!espn) return null;
  const hits = espn.byName.get(normName(p.name)) ?? [];
  return hits.length === 1 ? String(hits[0].id) : null;
}

/** Which Sleeper projection column fits this league's scoring. */
export function projectionColumn(scoring: string | null): 'ppr' | 'half' | 'std' {
  const s = (scoring ?? '').toLowerCase();
  if (s.includes('half')) return 'half';
  if (s.includes('standard') || s === 'std') return 'std';
  return 'ppr';
}

/** News inside this window gets the scroll. */
export const NEWS_FRESH_MS = 72 * 60 * 60 * 1000;

export type PlayerInsight = {
  tag: string | null;
  level: InjuryLevel | null;
  /** "Knee — Limited practice". Null when there is nothing to say. */
  detail: string | null;
  projection: number | null;
  projectionSource: 'ESPN' | 'Sleeper' | null;
  espnId: string | null;
  /** Fresh news exists (within NEWS_FRESH_MS). */
  hasNews: boolean;
  lastNewsAt: number | null;
};

export type InsightSources = {
  sleeper: SleeperIndex | null;
  projections: Projections | null;
  espn: EspnIndex | null;
  now?: number;
};

export function insightFor(p: RosterPlayer, league: League, src: InsightSources): PlayerInsight {
  const now = src.now ?? Date.now();
  const nfl = league.sport === 'nfl';
  const sid = nfl ? sleeperIdFor(p, league, src.sleeper) : null;
  const info = sid ? src.sleeper?.byId[sid] ?? null : null;
  // The league provider's status wins; Sleeper fills in when the provider has none.
  const status = p.injury ?? info?.injury_status ?? null;

  const bits = [info?.injury_body_part, info?.injury_notes].filter(Boolean) as string[];
  if (info?.practice_participation) bits.push(`${info.practice_participation} practice`);

  let projection: number | null = null;
  let projectionSource: PlayerInsight['projectionSource'] = null;
  if (p.projected != null) {
    projection = p.projected;
    projectionSource = league.provider === 'espn' ? 'ESPN' : null;
  } else if (nfl && sid && src.projections?.[sid]) {
    const v = src.projections[sid][projectionColumn(league.scoring)];
    if (typeof v === 'number') {
      projection = Math.round(v * 10) / 10;
      projectionSource = 'Sleeper';
    }
  }

  const espnId = espnIdFor(p, league, src.espn, info);
  const lastNewsAt = espnId ? src.espn?.byId.get(espnId)?.lastNewsDate ?? null : null;

  return {
    tag: injuryTag(status),
    level: injuryLevel(status),
    detail: bits.length ? bits.join(' — ') : null,
    projection,
    projectionSource,
    espnId,
    hasNews: lastNewsAt != null && now - lastNewsAt < NEWS_FRESH_MS,
    lastNewsAt,
  };
}

export type NewsItem = { id: string; headline: string; story: string | null; published: string; source: string | null };

/** ESPN's per-player news response → items, newest first. */
export function parseEspnNews(raw: unknown): NewsItem[] {
  const feed = raw && typeof raw === 'object' && Array.isArray((raw as { feed?: unknown }).feed) ? (raw as { feed: unknown[] }).feed : [];
  return feed
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      id: String(x.id ?? x.contentKey ?? x.published ?? Math.random()),
      headline: String(x.headline ?? x.description ?? '').trim(),
      story: typeof x.story === 'string' && x.story.trim() ? x.story.replace(/<[^>]+>/g, '').trim() : null,
      published: String(x.published ?? x.lastModified ?? ''),
      source: typeof x.type === 'string' ? x.type : null,
    }))
    .filter((n) => n.headline)
    .sort((a, b) => b.published.localeCompare(a.published));
}

export const ESPN_NEWS_GAME: Record<Sport, string> = { nfl: 'ffl', nba: 'fba', mlb: 'flb', nhl: 'fhl' };

/** "3h ago", "2d ago". */
export function newsAge(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const h = Math.max(0, Math.floor((now - t) / 3_600_000));
  if (h < 1) return 'just now';
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
