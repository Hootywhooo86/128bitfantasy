import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkApis, missingPaths, probes, runProbe } from './health';

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('api watch', () => {
  it('finds missing dotted paths', () => {
    expect(missingPaths({ a: { b: 1 } }, ['a.b', 'a.c', 'x'])).toEqual(['a.c', 'x']);
  });

  it('probes every provider', () => {
    expect(probes(2026).map((p) => p.provider).sort()).toEqual(['bit128', 'espn', 'fantrax', 'fleaflicker', 'mfl', 'sleeper', 'yahoo']);
  });

  it('calls a renamed field a change, not an outage', async () => {
    const espn = probes(2026).find((p) => p.provider === 'espn')!;
    vi.stubGlobal('fetch', async () => respond(200, { id: 2026, scoringPeriod: { id: 4 } }));
    expect(await runProbe(espn)).toEqual({ status: 'changed', detail: 'Missing currentScoringPeriod.id' });
    vi.stubGlobal('fetch', async () => respond(200, { id: 2026, currentScoringPeriod: { id: 4 } }));
    expect((await runProbe(espn)).status).toBe('ok');
  });

  it('treats Yahoo asking for a login as alive, and a redirect page as a change', async () => {
    const yahoo = probes().find((p) => p.provider === 'yahoo')!;
    expect(yahoo.url).toContain('fantasysports.yahooapis.com');
    vi.stubGlobal('fetch', async () => respond(401, { error: { description: 'Please provide valid credentials.' } }));
    expect((await runProbe(yahoo)).status).toBe('ok');
    vi.stubGlobal('fetch', async () => respond(200, '<html>moved</html>'));
    expect((await runProbe(yahoo)).status).toBe('changed');
  });

  it('accepts Fantrax answering an unknown league with its error object', async () => {
    const fx = probes().find((p) => p.provider === 'fantrax')!;
    vi.stubGlobal('fetch', async () => respond(200, { error: { code: 'WARNING', message: 'not found' } }));
    expect((await runProbe(fx)).status).toBe('ok');
  });

  it('reports HTML and errors as down or changed', async () => {
    vi.stubGlobal('fetch', async () => respond(503, '<html>'));
    const r = await checkApis();
    expect(r.results.sleeper.status).toBe('down');
    vi.stubGlobal('fetch', async () => respond(200, '<html>'));
    expect((await checkApis()).results.sleeper.status).toBe('changed');
  });
});
