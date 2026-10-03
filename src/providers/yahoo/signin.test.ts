import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyChecks, redact, reportText, yahooCheck } from './diagnose';
import { exchangeYahooCode, tokenRequestParts, yahooAuthorizeUrl } from './oauth';
import { challengeFor } from './pkce';
import userLeagues from './fixtures/userLeagues.json';

afterEach(() => vi.unstubAllGlobals());

const ID = 'dj0yJmk9' + 'a'.repeat(60);
const conn = (over = {}) => ({
  provider: 'yahoo' as const,
  clientId: ID,
  clientSecret: '',
  accessToken: 'ACCESS-TOKEN-123456',
  refreshToken: 'REFRESH-TOKEN-123456',
  expiresAt: Date.now() + 30 * 60_000,
  ...over,
});

describe('yahoo sign-in, both app types', () => {
  it('confidential: Basic auth, no client_id in the body', () => {
    const p = tokenRequestParts('id', 'secret', { grant_type: 'authorization_code', code: 'c' });
    expect(p.headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(p.body).not.toContain('client_id');
    expect(p.body).toContain('redirect_uri=oob');
  });

  it('public: client_id in the body, no Authorization header', () => {
    const p = tokenRequestParts('id', null, { grant_type: 'authorization_code', code: 'c', code_verifier: 'v' });
    expect(p.headers.Authorization).toBeUndefined();
    expect(new URLSearchParams(p.body).get('client_id')).toBe('id');
    expect(new URLSearchParams(p.body).get('code_verifier')).toBe('v');
  });

  it('public sign-in links carry the PKCE challenge; confidential ones do not', () => {
    const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const u = new URL(yahooAuthorizeUrl(' id ', v));
    expect(u.searchParams.get('code_challenge')).toBe(challengeFor(v));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(new URL(yahooAuthorizeUrl('id')).searchParams.get('code_challenge')).toBeNull();
  });

  it('sends the verifier with the code and reads the tokens', async () => {
    let sent = '';
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
    });
    const t = await exchangeYahooCode('id', null, ' 3xh2z2g ', 'verifier');
    expect(t.accessToken).toBe('a');
    expect(new URLSearchParams(sent).get('code')).toBe('3xh2z2g');
    expect(new URLSearchParams(sent).get('code_verifier')).toBe('verifier');
  });

  it('turns a public-app refusal into advice about the secret', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'invalid_client', error_description: 'client authentication failed' }), { status: 401 }));
    await expect(exchangeYahooCode('id', null, 'c', 'v')).rejects.toThrow(/wants a Client Secret.*client authentication failed/);
  });

  it('keeps the start of a non-JSON error page', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html><body>Service unavailable</body></html>', { status: 503 }));
    await expect(exchangeYahooCode('id', 's', 'c')).rejects.toThrow(/Service unavailable/);
  });
});

describe('yahoo check', () => {
  it('spots a cut-off Client ID', () => {
    expect(keyChecks('abc', '')[0].ok).toBe(false);
    expect(keyChecks(ID, '')[1].detail).toMatch(/Public/);
  });

  it('never leaks tokens', () => {
    expect(redact('Bearer ACCESS-TOKEN-123456 failed', ['ACCESS-TOKEN-123456'])).toBe('Bearer ••• failed');
  });

  it('walks to the leagues and names them', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(userLeagues), { headers: { 'content-type': 'application/json' } }));
    const steps = await yahooCheck(conn(), ID, '');
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(steps.at(-1)?.detail).toContain('Freddy Beach Baseball');
  });

  it('reports the failing step with what Yahoo said', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"description":"Please provide valid credentials. ACCESS-TOKEN-123456"}}', { status: 401 }));
    const steps = await yahooCheck(conn(), ID, '');
    const last = steps.at(-1)!;
    expect(last).toMatchObject({ step: 'Read leagues', ok: false });
    expect(last.detail).toContain('HTTP 401');
    expect(last.detail).not.toContain('ACCESS-TOKEN-123456');
    expect(reportText(steps)).toContain('XX  Read leagues');
  });

  it('says to sign in first when there is no login', async () => {
    const steps = await yahooCheck(null, ID, '');
    expect(steps.at(-1)).toMatchObject({ step: 'Signed in', ok: false });
  });
});
