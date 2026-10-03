/**
 * Network deadlines.
 *
 * Stadiums and sports bars have terrible signal, and Sunday at 12:55 is when
 * every fantasy API is slowest. Error handling alone does not deliver that — a request that hangs
 * never rejects, so none of the offline paths downstream ever run. Every fetch
 * in the app needs a deadline that fires on its own.
 *
 * The timeout logic is kept separate from fetch so it can be tested against a
 * promise that simply never settles, which is the case that matters.
 */

/** Thrown when a request passed its deadline, as opposed to failing outright. */
export class NetworkTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, label?: string) {
    super(
      label
        ? `${label} timed out after ${Math.round(timeoutMs / 1000)}s`
        : `Request timed out after ${Math.round(timeoutMs / 1000)}s`
    );
    this.name = 'NetworkTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** A league read the user is waiting on. Short on purpose. */
export const LOOKUP_TIMEOUT_MS = 8_000;

/** A model reply. Long, because a slow answer is still a useful answer. */
export const AI_TIMEOUT_MS = 60_000;

/** A model reply that searches the web first — several fetches before it starts writing. */
export const AI_WEB_TIMEOUT_MS = 120_000;

export type WithTimeoutOptions = {
  timeoutMs?: number;
  /** An outer signal — a cancel button, or unmount. Composes with the deadline. */
  signal?: AbortSignal;
  /** Used in the timeout message, e.g. "Sleeper rosters". */
  label?: string;
};

/**
 * Runs `work` with an abort signal that fires at the deadline, or earlier if
 * the caller's own signal does.
 *
 * A deadline breach throws NetworkTimeoutError so callers can tell "too slow"
 * from "refused"; an outer cancel propagates whatever `work` rejects with, so
 * a deliberate cancel is not reported as a timeout.
 */
export function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: WithTimeoutOptions = {}
): Promise<T> {
  const { timeoutMs = LOOKUP_TIMEOUT_MS, signal: outer, label } = options;

  // An already-cancelled caller should not start the request at all. Starting
  // it with a pre-aborted signal would hang anything that waits for the abort
  // event, because that event has already fired.
  if (outer?.aborted) {
    return Promise.reject(outer.reason ?? new Error('Aborted before starting'));
  }

  const controller = new AbortController();
  let timedOut = false;

  const onOuterAbort = () => controller.abort();
  outer?.addEventListener('abort', onOuterAbort);

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  };

  return work(controller.signal).then(
    (value) => {
      cleanup();
      return value;
    },
    (error: unknown) => {
      cleanup();
      // Only the deadline produces a timeout error. An outer cancel keeps its
      // own rejection so "you pressed stop" is not reported as "too slow".
      if (timedOut) throw new NetworkTimeoutError(timeoutMs, label);
      throw error;
    }
  );
}

/**
 * `fetch` with a deadline. Use this instead of bare fetch.
 *
 * A `signal` passed in `init` is composed with the deadline rather than
 * replaced. Callers habitually put it there, and silently dropping it would
 * break cancel buttons in a way nothing would notice.
 */
export function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  options: WithTimeoutOptions = {}
): Promise<Response> {
  const { signal: initSignal, ...rest } = init;
  return withTimeout((signal) => fetch(input, { ...rest, signal }), {
    ...options,
    signal: options.signal ?? initSignal ?? undefined,
  });
}
