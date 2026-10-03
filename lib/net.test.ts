import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_TIMEOUT_MS,
  LOOKUP_TIMEOUT_MS,
  NetworkTimeoutError,
  fetchWithTimeout,
  withTimeout,
} from './net';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A request that never settles — the case error handling alone cannot catch. */
function hangs(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

describe('deadlines', () => {
  it('gives up on a request that never settles', async () => {
    const promise = withTimeout(hangs, { timeoutMs: 1000, label: 'Barcode lookup' });
    const assertion = expect(promise).rejects.toBeInstanceOf(NetworkTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('names what timed out and how long it waited', async () => {
    const promise = withTimeout(hangs, { timeoutMs: 8000, label: 'Barcode lookup' });
    const assertion = expect(promise).rejects.toThrow('Barcode lookup timed out after 8s');
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });

  it('aborts the underlying work rather than leaving it running', async () => {
    let seen: AbortSignal | null = null;
    const promise = withTimeout(
      (signal) => {
        seen = signal;
        return hangs(signal);
      },
      { timeoutMs: 500 }
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(NetworkTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(seen!.aborted).toBe(true);
  });
});

describe('not interfering with a request that completes', () => {
  it('passes the value straight through', async () => {
    await expect(withTimeout(async () => 'ok', { timeoutMs: 1000 })).resolves.toBe('ok');
  });

  it('propagates a real failure unchanged, not as a timeout', async () => {
    const boom = new Error('Network request failed');
    await expect(withTimeout(async () => Promise.reject(boom), { timeoutMs: 1000 })).rejects.toBe(
      boom
    );
  });

  it('does not fire after the work has finished', async () => {
    await expect(withTimeout(async () => 'done', { timeoutMs: 100 })).resolves.toBe('done');
    // If the timer had leaked it would abort here with nothing listening.
    await vi.advanceTimersByTimeAsync(10_000);
  });
});

describe('composing with a caller cancel', () => {
  it('stops when the caller aborts, and does not call it a timeout', async () => {
    const outer = new AbortController();
    const promise = withTimeout(hangs, { timeoutMs: 10_000, signal: outer.signal });
    outer.abort();
    await expect(promise).rejects.not.toBeInstanceOf(NetworkTimeoutError);
  });

  it('never starts work when the caller has already aborted', async () => {
    // Starting it would hand `work` a pre-aborted signal, whose abort event has
    // already fired — anything waiting on that event would hang forever.
    const outer = new AbortController();
    outer.abort();
    let started = false;
    const promise = withTimeout(
      (signal) => {
        started = true;
        return hangs(signal);
      },
      { timeoutMs: 10_000, signal: outer.signal }
    );
    await expect(promise).rejects.toThrow();
    expect(started).toBe(false);
  });
});

describe('the configured deadlines', () => {
  it('keeps a mid-workout lookup short and a model reply generous', () => {
    expect(LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(AI_TIMEOUT_MS).toBeGreaterThan(LOOKUP_TIMEOUT_MS);
  });
});

describe('fetchWithTimeout signal handling', () => {
  it('composes a signal passed in init rather than dropping it', async () => {
    // Callers habitually put signal in init. Overwriting it would break cancel
    // buttons silently, which is exactly what happened on the first attempt.
    const outer = new AbortController();
    let seen: AbortSignal | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: string, init?: RequestInit) => {
      seen = init?.signal ?? null;
      return hangs(init!.signal!);
    }) as typeof fetch;

    try {
      const promise = fetchWithTimeout('https://example.invalid', { signal: outer.signal });
      const assertion = expect(promise).rejects.toThrow();
      outer.abort();
      await assertion;
      // The signal handed to fetch is the composed one, and the outer abort
      // reached it.
      expect(seen).not.toBeNull();
      expect(seen!.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('still times out when init carries a signal that never fires', async () => {
    const idle = new AbortController();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: string, init?: RequestInit) =>
      hangs(init!.signal!)) as typeof fetch;
    try {
      const promise = fetchWithTimeout(
        'https://example.invalid',
        { signal: idle.signal },
        { timeoutMs: 1000, label: 'Probe' }
      );
      const assertion = expect(promise).rejects.toBeInstanceOf(NetworkTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
