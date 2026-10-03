import { afterEach, describe, expect, it, vi } from 'vitest';
import { coachChat, providerCanSearchWeb, webSearchUnavailableReason, withSources, type ChatMessage } from './ai-coach';

const KEY = 'sk-test-key-1234567890';
const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'HelloFresh cheese tortellini' },
];

type Call = { url: string; body: Record<string, unknown> };

function stubFetch(...replies: { status?: number; json: unknown }[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const r = replies[Math.min(i++, replies.length - 1)];
      const status = r.status ?? 200;
      return new Response(JSON.stringify(r.json), { status });
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web search per provider', () => {
  it('Anthropic: sends the search tool and reads citations from the response, not the text', async () => {
    const calls = stubFetch({
      json: {
        stop_reason: 'end_turn',
        content: [
          { type: 'server_tool_use', id: 'x', name: 'web_search' },
          {
            type: 'web_search_tool_result',
            content: [{ type: 'web_search_result', url: 'https://www.hellofresh.com/r/1', title: 'Tortellini' }],
          },
          // One JSON answer split at a citation. Joining with a newline would
          // break the string literal it falls inside.
          { type: 'text', text: '{"items":[{"name":"Tort' },
          {
            type: 'text',
            text: 'ellini","calories":700}]}',
            citations: [{ type: 'web_search_result_location', url: 'https://www.hellofresh.com/r/1', title: 'Tortellini' }],
          },
        ],
      },
    });
    const res = await coachChat({ provider: 'anthropic', apiKey: KEY, model: 'm', messages: MESSAGES, webSearch: true });
    expect(calls[0].body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
    expect(JSON.parse(res.content).items[0].name).toBe('Tortellini');
    expect(res.web).toEqual({
      status: 'on',
      sources: [{ url: 'https://www.hellofresh.com/r/1', title: 'Tortellini' }],
    });
  });

  it('Anthropic: continues a paused search turn rather than returning half an answer', async () => {
    const calls = stubFetch(
      { json: { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 'x', name: 'web_search' }] } },
      { json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } }
    );
    const res = await coachChat({ provider: 'anthropic', apiKey: KEY, model: 'm', messages: MESSAGES, webSearch: true });
    expect(calls).toHaveLength(2);
    const second = calls[1].body.messages as { role: string }[];
    expect(second[second.length - 1].role).toBe('assistant');
    expect(res.content).toBe('done');
  });

  it('Gemini: grounds with Google Search and reads the grounding chunks', async () => {
    const calls = stubFetch({
      json: {
        candidates: [
          {
            content: { parts: [{ text: '{"items":[]}' }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: 'https://g.co/x', title: 'hellofresh.com' } }] },
          },
        ],
      },
    });
    const res = await coachChat({ provider: 'gemini', apiKey: KEY, model: 'gemini-2.0-flash', messages: MESSAGES, webSearch: true });
    expect(calls[0].body.tools).toEqual([{ google_search: {} }]);
    expect(res.web).toEqual({ status: 'on', sources: [{ url: 'https://g.co/x', title: 'hellofresh.com' }] });
  });

  it('OpenAI: uses the Responses API with web_search', async () => {
    const calls = stubFetch({
      json: {
        output: [
          { type: 'web_search_call' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'answer',
                annotations: [{ type: 'url_citation', url: 'https://a.com', title: 'A' }],
              },
            ],
          },
        ],
      },
    });
    const res = await coachChat({ provider: 'openai', apiKey: KEY, model: 'gpt-4o-mini', messages: MESSAGES, webSearch: true });
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0].body.tools).toEqual([{ type: 'web_search' }]);
    expect(calls[0].body.instructions).toBe('sys');
    expect(res.content).toBe('answer');
    expect(res.web).toEqual({ status: 'on', sources: [{ url: 'https://a.com', title: 'A' }] });
  });

  it('OpenRouter: adds the web plugin', async () => {
    const calls = stubFetch({
      json: {
        choices: [
          {
            message: {
              content: 'ok',
              annotations: [{ type: 'url_citation', url_citation: { url: 'https://b.com', title: 'B' } }],
            },
          },
        ],
      },
    });
    const res = await coachChat({ provider: 'openrouter', apiKey: KEY, model: 'x/y', messages: MESSAGES, webSearch: true });
    expect(calls[0].body.plugins).toEqual([{ id: 'web' }]);
    expect(res.web).toEqual({ status: 'on', sources: [{ url: 'https://b.com', title: 'B' }] });
  });

  it('Groq: browser search on GPT-OSS, sources from executed_tools, citation marks stripped', async () => {
    const calls = stubFetch({
      json: {
        choices: [
          {
            message: {
              content: '{"items":[{"name":"Tortellini【2†L6-L10】","calories":700}]}',
              executed_tools: [
                {
                  type: 'browser_search',
                  browser_results: [{ url: 'https://www.hellofresh.com/r/1', title: 'Tortellini' }],
                  search_results: { results: [{ url: 'https://example.com/x', title: 'X' }] },
                },
              ],
            },
          },
        ],
      },
    });
    const res = await coachChat({
      provider: 'groq',
      apiKey: KEY,
      model: 'openai/gpt-oss-120b',
      messages: MESSAGES,
      webSearch: true,
      forceSearch: true,
    });
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0].body.tools).toEqual([{ type: 'browser_search' }]);
    expect(calls[0].body.tool_choice).toBe('required');
    expect(calls[0].body.plugins).toBeUndefined();
    expect(JSON.parse(res.content).items[0].name).toBe('Tortellini');
    expect(res.web).toEqual({
      status: 'on',
      sources: [
        { url: 'https://www.hellofresh.com/r/1', title: 'Tortellini' },
        { url: 'https://example.com/x', title: 'X' },
      ],
    });
  });

  it('Groq: leaves searching to the model when not forced', async () => {
    const calls = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    await coachChat({ provider: 'groq', apiKey: KEY, model: 'openai/gpt-oss-20b', messages: MESSAGES, webSearch: true });
    expect(calls[0].body.tool_choice).toBe('auto');
  });

  it('Groq: a model without browser search is told apart from a provider without it', async () => {
    const calls = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    const res = await coachChat({ provider: 'groq', apiKey: KEY, model: 'qwen/qwen3.8-27b', messages: MESSAGES, webSearch: true });
    expect(calls[0].body.tools).toBeUndefined();
    expect(res.web).toEqual({ status: 'unsupported' });
    expect(providerCanSearchWeb('groq', 'qwen/qwen3.8-27b')).toBe(false);
    expect(providerCanSearchWeb('groq', 'openai/gpt-oss-120b')).toBe(true);
    expect(webSearchUnavailableReason('groq', 'qwen/qwen3.8-27b')).toContain('gpt-oss');
  });

  it('Hugging Face: says it cannot search rather than pretending to', async () => {
    const calls = stubFetch({ json: { choices: [{ message: { content: 'ok' } }] } });
    const res = await coachChat({ provider: 'huggingface', apiKey: KEY, model: 'm', messages: MESSAGES, webSearch: true });
    expect(calls[0].body.plugins).toBeUndefined();
    expect(res.web).toEqual({ status: 'unsupported' });
  });

  it('sends no search tool when it is turned off', async () => {
    const calls = stubFetch({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } });
    const res = await coachChat({ provider: 'anthropic', apiKey: KEY, model: 'm', messages: MESSAGES });
    expect(calls[0].body.tools).toBeUndefined();
    expect(res.web).toEqual({ status: 'off' });
  });
});

describe('when the provider refuses the search', () => {
  it('answers without it and says the search did not run', async () => {
    const calls = stubFetch(
      { status: 400, json: { error: { message: 'web search is not enabled for this organization' } } },
      { json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } }
    );
    const res = await coachChat({ provider: 'anthropic', apiKey: KEY, model: 'm', messages: MESSAGES, webSearch: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.tools).toBeUndefined();
    expect(res.web).toEqual({ status: 'failed', message: 'web search is not enabled for this organization' });
  });

  it('does not retry a bad key — it would fail the same way, twice as slowly', async () => {
    const calls = stubFetch({ status: 401, json: { error: { message: 'invalid x-api-key' } } });
    await expect(
      coachChat({ provider: 'anthropic', apiKey: KEY, model: 'm', messages: MESSAGES, webSearch: true })
    ).rejects.toThrow('invalid x-api-key');
    expect(calls).toHaveLength(1);
  });
});

describe('sources on a coach reply', () => {
  it('appends the pages the provider reported', () => {
    expect(withSources('Hi', { status: 'on', sources: [{ url: 'https://a.com', title: 'A' }] })).toBe(
      'Hi\n\nSources:\n• A — https://a.com'
    );
  });

  it('adds nothing when nothing was looked up', () => {
    expect(withSources('Hi', { status: 'on', sources: [] })).toBe('Hi');
    expect(withSources('Hi', { status: 'unsupported' })).toBe('Hi');
  });
});
