/**
 * Coaches Corner: one tap, the coach reads the internet and makes the call.
 *
 * Always asks for web search — a start/sit call from a model's memory is a
 * call made on last season's depth chart. Where the chosen AI cannot search,
 * the answer still comes back, and the result says plainly that nothing was
 * looked up.
 */
import { buildLeagueContext, cornerPrompt, type CornerMode } from '@/src/sports/coach-context';
import type { LeagueSnapshot } from '@/src/sports/models';
import { AiCoachError, buildSystemPrompt, coachChat, providerCanSearchWeb, type WebSearchOutcome } from './ai-coach';
import { getAiRuntime } from './settings';

export type CornerReply = {
  content: string;
  web: WebSearchOutcome;
  model: string;
};

export async function askCoachesCorner(
  snapshot: LeagueSnapshot,
  mode: CornerMode,
  question?: string,
  signal?: AbortSignal
): Promise<CornerReply> {
  const cfg = await getAiRuntime();
  if (!cfg.apiKey) {
    throw new AiCoachError('Coaches Corner needs an AI key. Add one in Settings → AI — the same kind 128BIT FIT uses.', 401);
  }
  const canSearch = providerCanSearchWeb(cfg.provider, cfg.model);
  const res = await coachChat({
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    signal,
    webSearch: true,
    forceSearch: true,
    messages: [
      { role: 'system', content: buildSystemPrompt(canSearch) },
      { role: 'user', content: cornerPrompt(mode, buildLeagueContext(snapshot), question) },
    ],
  });
  return { content: res.content, web: res.web, model: res.model };
}

/** One honest line about whether the coach actually read anything. */
export function webNote(web: WebSearchOutcome): string {
  switch (web.status) {
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
