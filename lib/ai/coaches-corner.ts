/**
 * Coaches Corner: a coach for one team in one league.
 *
 * Opened from a team, it sees that team's roster, matchup and league — fresh
 * each time you ask — and keeps the conversation, so follow-ups ("what about
 * the TE?") work.
 *
 * Always asks for web search — a start/sit call from a model's memory is a
 * call made on last season's depth chart. Where the chosen AI cannot search,
 * the answer still comes back, and the result says plainly that nothing was
 * looked up.
 */
import { getJsonItem, setJsonItem } from '@/lib/storage/kv';
import { buildLeagueContext, cornerQuestion, tradeQuestion, type CornerMode, type PlayerExtras } from '@/src/sports/coach-context';
import { insightFor, type EspnIndex, type Projections, type SleeperIndex } from '@/src/sports/insights';
import { espnIndex, nflProjections, sleeperIndex } from '@/lib/insights';
import type { LeagueSnapshot } from '@/src/sports/models';
import { leagueKey } from '@/src/sports/prefs';
import {
  AiCoachError,
  buildSystemPrompt,
  coachChat,
  providerCanSearchWeb,
  type ChatMessage,
  type WebSearchOutcome,
  type WebSource,
} from './ai-coach';
import { getAiRuntime } from './settings';

export type ThreadMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Assistant only. */
  web?: WebSearchOutcome;
  model?: string;
};

/** Enough history for follow-ups without paying for a novel every call. */
const KEEP = 24;
const SEND = 8;

const threadKey = (s: LeagueSnapshot, teamId: string) => `coach_thread_v1_${leagueKey(s.league)}_${teamId}`;

export async function loadThread(s: LeagueSnapshot, teamId: string): Promise<ThreadMessage[]> {
  return (await getJsonItem<ThreadMessage[]>(threadKey(s, teamId))) ?? [];
}

export async function clearThread(s: LeagueSnapshot, teamId: string): Promise<void> {
  await setJsonItem(threadKey(s, teamId), []);
}

/** The messages sent to the model: context in the system prompt, then recent turns. */
export function buildMessages(
  snapshot: LeagueSnapshot,
  teamId: string,
  history: ThreadMessage[],
  question: string,
  canSearch: boolean,
  alsoTeamIds: string[] = [],
  extras: PlayerExtras = {}
): ChatMessage[] {
  const system = `${buildSystemPrompt(canSearch)}\n\n--- League context (live from the provider) ---\n${buildLeagueContext(snapshot, teamId, alsoTeamIds, extras)}`;
  return [
    { role: 'system', content: system },
    ...history.slice(-SEND).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];
}

/**
 * Projections and injury detail for every rostered player, best effort: each
 * source gets a few seconds and anything missing is simply left out.
 */
export async function loadExtras(snapshot: LeagueSnapshot): Promise<PlayerExtras> {
  const within = <T>(p: Promise<T>): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
  const nfl = snapshot.league.sport === 'nfl';
  const [sleeper, projections, espn] = await Promise.all([
    nfl ? within<SleeperIndex>(sleeperIndex()) : Promise.resolve(null),
    nfl && snapshot.period ? within<Projections>(nflProjections(snapshot.league.season, snapshot.period)) : Promise.resolve(null),
    within<EspnIndex>(espnIndex(snapshot.league.sport)),
  ]);
  const out: PlayerExtras = {};
  for (const r of snapshot.rosters)
    for (const p of r.players) {
      const i = insightFor(p, snapshot.league, { sleeper, projections, espn });
      if (i.projection != null || i.detail) out[p.id] = { projection: i.projection, detail: i.detail, source: i.projectionSource };
    }
  return out;
}

/** A deal for TRADE CHECK: player names on each side and who it's with. */
export type TradeDeal = { partnerId: string; give: string[]; get: string[] };

export async function askCoach(
  snapshot: LeagueSnapshot,
  teamId: string,
  mode: CornerMode,
  question: string | undefined,
  signal?: AbortSignal,
  deal?: TradeDeal
): Promise<ThreadMessage[]> {
  const cfg = await getAiRuntime();
  if (!cfg.apiKey) {
    throw new AiCoachError('Coaches Corner needs an AI key. Add one in Settings → Coaches Corner AI — the same kind 128BIT FIT uses.', 401);
  }
  const history = await loadThread(snapshot, teamId);
  const scouting = teamId !== snapshot.league.myTeamId;
  const partner = deal ? snapshot.teams.find((t) => t.id === deal.partnerId)?.name ?? 'them' : '';
  const text = mode === 'grade' && deal ? tradeQuestion(deal.give, deal.get, partner, question) : cornerQuestion(mode, question, scouting);
  const canSearch = providerCanSearchWeb(cfg.provider, cfg.model);

  const res = await coachChat({
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    signal,
    webSearch: true,
    forceSearch: true,
    messages: buildMessages(snapshot, teamId, history, text, canSearch, deal ? [deal.partnerId] : [], await loadExtras(snapshot)),
  });

  const now = Date.now();
  const next: ThreadMessage[] = [
    ...history,
    { role: 'user' as const, content: text, at: now },
    { role: 'assistant' as const, content: res.content, at: now, web: res.web, model: res.model },
  ].slice(-KEEP);
  await setJsonItem(threadKey(snapshot, teamId), next);
  return next;
}

export function sourcesOf(m: ThreadMessage): WebSource[] {
  return m.web?.status === 'on' ? m.web.sources : [];
}

/** One honest line about whether the coach actually read anything. */
export function webNote(web: WebSearchOutcome | undefined): string {
  switch (web?.status) {
    case 'on':
      return web.sources.length
        ? `Checked ${web.sources.length} source${web.sources.length === 1 ? '' : 's'} online`
        : 'Could search, but did not — this call is from roster data alone';
    case 'failed':
      return `Web search failed (${web.message}). This call is from roster data alone.`;
    case 'unsupported':
      return 'Your AI cannot search the web. This call is from roster data alone.';
    default:
      return 'No web search';
  }
}
