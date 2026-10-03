import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson } from './http';
import { ProviderError } from './types';

afterEach(() => vi.unstubAllGlobals());

describe('getJson', () => {
  it('retries once after a dropped connection', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      if (n++ === 0) throw new TypeError('Failed to fetch');
      return new Response('{"ok":1}');
    });
    expect(await getJson('sleeper', 'https://x')).toEqual({ ok: 1 });
    expect(n).toBe(2);
  });

  it('retries a gateway error but not a refusal', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => (n++ === 0 ? new Response('', { status: 503 }) : new Response('[1]')));
    expect(await getJson('sleeper', 'https://x')).toEqual([1]);
    n = 0;
    vi.stubGlobal('fetch', async () => {
      n++;
      return new Response('', { status: 401 });
    });
    await expect(getJson('espn', 'https://x')).rejects.toThrow(/Reconnect|refused/);
    expect(n).toBe(1);
  });

  it('turns an empty body into an error, not null data', async () => {
    vi.stubGlobal('fetch', async () => new Response('null'));
    await expect(getJson('sleeper', 'https://x')).rejects.toBeInstanceOf(ProviderError);
  });
});
