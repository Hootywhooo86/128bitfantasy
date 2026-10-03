/**
 * Betting odds, read-only, from ESPN's public feeds (supplied by DraftKings):
 *
 * - Game lines (scoreboard): spread, total and moneyline with prices, opening
 *   and current, and DraftKings links that open that exact bet in DraftKings.
 * - Player lines (props): the over/under numbers per player, opening and
 *   current, and which scorer markets exist. ESPN's free feed carries the
 *   lines but not their prices, so prices are never shown for player lines.
 *
 * No key, no account. This app never places a bet: a link hands the user to
 * the sportsbook, where its own age and location checks apply.
 *
 * Pure: responses in, odds out.
 */
import type { Sport } from '@/src/sports/models';

export const ESPN_SPORT_PATH: Record<Sport, string> = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
};

/** The props server spells it differently: football/leagues/nfl. */
export function corePath(sport: Sport): string {
  const [sportName, league] = ESPN_SPORT_PATH[sport].split('/');
  return `${sportName}/leagues/${league}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

export type Price = { line: string | null; odds: string | null; link: string | null };

export type GameOdds = {
  eventId: string;
  startsAt: string;
  status: string;
  book: string;
  home: { teamId: string; abbr: string; name: string };
  away: { teamId: string; abbr: string; name: string };
  /** e.g. "IND -4.5" */
  details: string | null;
  spread: { home: Price; away: Price } | null;
  total: { over: Price; under: Price } | null;
  moneyline: { home: Price; away: Price } | null;
  /** The game's page in the sportsbook, where its player bets live. */
  eventUrl: string | null;
};

/**
 * ESPN wraps each DraftKings link in a tracking gateway with unfilled
 * placeholders; the real bet-slip link is its `preurl`. Only sportsbook
 * https links are passed on.
 */
export function directBetLink(href: unknown): string | null {
  const h = str(href);
  if (!h) return null;
  let target = h;
  try {
    const u = new URL(h);
    const pre = u.searchParams.get('preurl');
    if (pre) target = pre;
  } catch {
    return null;
  }
  try {
    const t = new URL(target);
    return t.protocol === 'https:' && /(^|\.)draftkings\.com$|(^|\.)fanduel\.com$|(^|\.)espnbet\.com$/.test(t.hostname) ? t.toString() : null;
  } catch {
    return null;
  }
}

/** sportsbook.draftkings.com/event/34118061?outcomes=… → the event page alone. */
export function eventPage(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.pathname.startsWith('/event/') ? `${u.origin}${u.pathname}` : null;
  } catch {
    return null;
  }
}

function price(side: unknown): Price {
  const s = isObj(side) ? side : {};
  // "close" is the current line; "open" is where it started.
  const cur = isObj(s.close) ? s.close : isObj(s.current) ? s.current : {};
  return { line: str(cur.line), odds: str(cur.odds), link: directBetLink(isObj(cur.link) ? cur.link.href : null) };
}

export function parseScoreboard(raw: unknown): GameOdds[] {
  const events = isObj(raw) && Array.isArray(raw.events) ? raw.events : [];
  const out: GameOdds[] = [];
  for (const e of events) {
    if (!isObj(e)) continue;
    const c = Array.isArray(e.competitions) && isObj(e.competitions[0]) ? e.competitions[0] : null;
    if (!c) continue;
    const teams = (Array.isArray(c.competitors) ? c.competitors : []).filter(isObj);
    const side = (ha: string) => {
      const t = teams.find((x) => x.homeAway === ha);
      const team = isObj(t?.team) ? t!.team : {};
      return { teamId: str(team.id) ?? '', abbr: str(team.abbreviation) ?? '', name: str(team.displayName) ?? '' };
    };
    const o = Array.isArray(c.odds) && isObj(c.odds[0]) ? c.odds[0] : null;
    const status = isObj(c.status) && isObj(c.status.type) ? str(c.status.type.name) ?? '' : '';
    const ml = o && isObj(o.moneyline) ? o.moneyline : null;
    const ps = o && isObj(o.pointSpread) ? o.pointSpread : null;
    const tot = o && isObj(o.total) ? o.total : null;
    const spread = ps ? { home: price(ps.home), away: price(ps.away) } : null;
    const total = tot ? { over: price(tot.over), under: price(tot.under) } : null;
    const moneyline = ml ? { home: price(ml.home), away: price(ml.away) } : null;
    const anyLink = [moneyline?.home.link, spread?.home.link, total?.over.link].find(Boolean) ?? null;
    out.push({
      eventId: str(e.id) ?? '',
      startsAt: str(e.date) ?? '',
      status,
      book: o && isObj(o.provider) ? str(o.provider.displayName) ?? str(o.provider.name) ?? 'Sportsbook' : 'Sportsbook',
      home: side('home'),
      away: side('away'),
      details: o ? str(o.details) : null,
      spread,
      total,
      moneyline,
      eventUrl: eventPage(anyLink),
    });
  }
  return out;
}

export function hasOdds(g: GameOdds): boolean {
  return !!(g.spread || g.total || g.moneyline);
}

/** The game a pro team plays in this slate, by ESPN team id. */
export function gameForTeam(games: GameOdds[], espnTeamId: string | null): GameOdds | null {
  if (!espnTeamId) return null;
  return games.find((g) => g.home.teamId === espnTeamId || g.away.teamId === espnTeamId) ?? null;
}

/**
 * Different providers spell team abbreviations differently (WAS / WSH,
 * JAC / JAX, KCC / KC). The game for a team abbreviation, with those folded.
 */
const NFL_ALIASES: Record<string, string> = {
  WAS: 'WSH', JAC: 'JAX', KCC: 'KC', GBP: 'GB', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR', LA: 'LAR',
};
export function gameForAbbr(games: GameOdds[], abbr: string | null, sport: Sport): GameOdds | null {
  if (!abbr) return null;
  const a = abbr.toUpperCase();
  const want = sport === 'nfl' ? NFL_ALIASES[a] ?? a : a;
  return games.find((g) => g.home.abbr.toUpperCase() === want || g.away.abbr.toUpperCase() === want) ?? null;
}

export type PlayerLine = {
  /** "Receiving Yards", "Receptions"… */
  market: string;
  line: number | null;
  openLine: number | null;
};

export type PlayerProps = {
  lines: PlayerLine[];
  /** Scorer markets offered for him: "Anytime Touchdown Scorer"… */
  scorer: string[];
};

/** "Total Receiving Yards (incl. overtime)" → "Receiving Yards". Null for markets we don't show. */
export function marketName(type: string): string | null {
  const m = type.match(/^Total (.+?)(?: \(incl\. overtime\))?$/i);
  if (!m) return null;
  const name = m[1].replace(/\bPlus\b/g, '+').trim();
  return /quarter|half|period|inning/i.test(name) ? null : name;
}

function athleteId(x: Obj): string | null {
  const ref = isObj(x.athlete) ? str(x.athlete.$ref) : null;
  const m = ref?.match(/\/athletes\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Prop entries for one game → per-player lines. ESPN lists alternate lines
 * as extra entries; the line offered most often is the main one.
 */
export function parseProps(raw: unknown): Map<string, PlayerProps> {
  const items = isObj(raw) && Array.isArray(raw.items) ? raw.items.filter(isObj) : [];
  const byPlayer = new Map<string, { lines: Map<string, { cur: number[]; open: number[] }>; scorer: Set<string> }>();
  for (const x of items) {
    const id = athleteId(x);
    const type = isObj(x.type) ? str(x.type.name) : null;
    if (!id || !type) continue;
    const p = byPlayer.get(id) ?? { lines: new Map(), scorer: new Set<string>() };
    byPlayer.set(id, p);
    if (/scorer$/i.test(type) && !/half|quarter|period|first team/i.test(type)) {
      p.scorer.add(type);
      continue;
    }
    const market = marketName(type);
    if (!market) continue;
    const cur = isObj(x.current) && isObj(x.current.target) ? Number(x.current.target.value) : NaN;
    const open = isObj(x.open) && isObj(x.open.target) ? Number(x.open.target.value) : NaN;
    const l = p.lines.get(market) ?? { cur: [], open: [] };
    if (Number.isFinite(cur)) l.cur.push(cur);
    if (Number.isFinite(open)) l.open.push(open);
    p.lines.set(market, l);
  }
  const mode = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const counts = new Map<number, number>();
    for (const v of xs) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  };
  const out = new Map<string, PlayerProps>();
  for (const [id, p] of byPlayer) {
    out.set(id, {
      lines: [...p.lines].map(([market, l]) => ({ market, line: mode(l.cur), openLine: mode(l.open) })).filter((l) => l.line != null),
      scorer: [...p.scorer].sort(),
    });
  }
  return out;
}

/** "-110" stays, "+170" stays, numbers get a sign. */
export function americanOdds(v: string | null): string {
  if (!v) return '—';
  return /^[+-]/.test(v) ? v : Number(v) > 0 ? `+${v}` : v;
}

/** How much a winning $10 bet pays at American odds, for the "payout" hint. */
export function payoutOn10(odds: string | null): number | null {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  const profit = n > 0 ? (10 * n) / 100 : (10 * 100) / -n;
  return Math.round((10 + profit) * 100) / 100;
}
