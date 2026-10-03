/**
 * Yahoo OAuth 2.0, out-of-band.
 *
 * Bring-your-own Yahoo app, like the AI key: the user registers a free app at
 * developer.yahoo.com (Fantasy Sports: read) and pastes its keys here; they
 * stay in this phone's keystore.
 *
 * Two kinds of Yahoo app work:
 * - Confidential: Client ID + Client Secret, sent as HTTP Basic auth.
 * - Public: Client ID only. No secret exists to send, so the sign-in uses
 *   PKCE — a fresh verifier per sign-in, its hash on the sign-in link, the
 *   verifier itself with the code.
 *
 * `redirect_uri=oob` makes Yahoo show the code on a page for the user to copy
 * back, which avoids needing a public https redirect we would have to host.
 */
import { fetchWithTimeout } from '@/lib/net';
import { ProviderError } from '../types';
import { challengeFor } from './pkce';

export const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
export const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
export const YAHOO_REDIRECT = 'oob';

export type YahooTokens = { accessToken: string; refreshToken: string; expiresAt: number };

/** The sign-in link. With a verifier (public apps), PKCE rides along. */
export function yahooAuthorizeUrl(clientId: string, verifier?: string | null): string {
  const p = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: YAHOO_REDIRECT,
    response_type: 'code',
    language: 'en-us',
  });
  if (verifier) {
    p.set('code_challenge', challengeFor(verifier));
    p.set('code_challenge_method', 'S256');
  }
  return `${YAHOO_AUTH_URL}?${p.toString()}`;
}

/** btoa is in Hermes and browsers; Buffer covers Node for tests. */
function base64(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  return (globalThis as unknown as { Buffer: { from(x: string): { toString(e: string): string } } }).Buffer.from(s).toString('base64');
}

export function parseTokenResponse(
  json: { access_token?: string; refresh_token?: string; expires_in?: number },
  now = Date.now(),
  previousRefresh?: string
): YahooTokens {
  if (!json.access_token) throw new ProviderError('yahoo', 'Yahoo did not return an access token.');
  const refreshToken = json.refresh_token ?? previousRefresh;
  if (!refreshToken) throw new ProviderError('yahoo', 'Yahoo did not return a refresh token.');
  // A minute early, so a request never leaves with a token about to lapse.
  return { accessToken: json.access_token, refreshToken, expiresAt: now + ((json.expires_in ?? 3600) - 60) * 1000 };
}

/**
 * Headers and body for a token request. Confidential apps authenticate with
 * Basic auth; public apps put their Client ID in the body and prove the
 * sign-in with the PKCE verifier instead.
 */
export function tokenRequestParts(
  clientId: string,
  clientSecret: string | null,
  body: Record<string, string>
): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const form: Record<string, string> = { redirect_uri: YAHOO_REDIRECT, ...body };
  if (clientSecret) headers.Authorization = `Basic ${base64(`${clientId.trim()}:${clientSecret.trim()}`)}`;
  else form.client_id = clientId.trim();
  return { headers, body: new URLSearchParams(form).toString() };
}

async function tokenRequest(
  clientId: string,
  clientSecret: string | null,
  body: Record<string, string>,
  previousRefresh?: string
): Promise<YahooTokens> {
  const parts = tokenRequestParts(clientId, clientSecret, body);
  const res = await fetchWithTimeout(YAHOO_TOKEN_URL, { method: 'POST', ...parts }, { label: 'Yahoo sign-in' });
  const text = await res.text().catch(() => '');
  let json: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON — keep the start of what Yahoo sent so the error says something.
  }
  if (!res.ok || !json.access_token) {
    const why = json.error_description ?? json.error ?? (text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : `HTTP ${res.status}`);
    throw new ProviderError('yahoo', yahooAuthMessage(json.error, why, !clientSecret), res.status);
  }
  return parseTokenResponse(json, Date.now(), previousRefresh);
}

export function exchangeYahooCode(
  clientId: string,
  clientSecret: string | null,
  code: string,
  verifier?: string | null
): Promise<YahooTokens> {
  return tokenRequest(clientId, clientSecret, {
    grant_type: 'authorization_code',
    code: code.trim(),
    ...(verifier ? { code_verifier: verifier } : {}),
  });
}

export function refreshYahooToken(clientId: string, clientSecret: string | null, refreshToken: string): Promise<YahooTokens> {
  return tokenRequest(clientId, clientSecret || null, { grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken);
}

/** What went wrong at Yahoo's sign-in, in words, with Yahoo's own reason kept. */
export function yahooAuthMessage(code: string | undefined, why: string, isPublic = false): string {
  const said = why ? ` (Yahoo said: ${why})` : '';
  switch ((code ?? '').toLowerCase()) {
    case 'invalid_grant':
      return `Yahoo rejected that code${said}. Codes work once and expire after a few minutes — tap SIGN IN WITH YAHOO again and paste the new one.`;
    case 'invalid_consumer_key':
    case 'invalid_client':
    case 'unauthorized_client':
      return isPublic
        ? `Yahoo wants a Client Secret for this app${said}. If your Yahoo app shows a Client Secret, paste it too; if it is a Public app, check the Client ID is copied in full.`
        : `Yahoo doesn't recognise that Client ID or Client Secret${said}. Copy both again from your app at developer.yahoo.com — the whole thing, no spaces.`;
    case 'invalid_redirect_uri':
    case 'redirect_uri_mismatch':
      return `Your Yahoo app's Redirect URI must be exactly: oob${said}.`;
    default:
      return `Yahoo sign-in failed${said}.`;
  }
}
