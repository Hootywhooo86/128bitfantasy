/**
 * Yahoo OAuth 2.0, out-of-band.
 *
 * Yahoo's token exchange needs the app's client secret, and a secret shipped
 * inside an APK is not a secret. So, like the AI key, it is bring-your-own:
 * the user registers a free app at developer.yahoo.com (Fantasy Sports: read),
 * pastes the client id and secret, and both stay in this phone's keystore.
 *
 * `redirect_uri=oob` makes Yahoo show the code on a page for the user to copy
 * back, which avoids needing a public https redirect we would have to host.
 */
import { fetchWithTimeout } from '@/lib/net';
import { ProviderError } from '../types';

export const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
export const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
export const YAHOO_REDIRECT = 'oob';

export type YahooTokens = { accessToken: string; refreshToken: string; expiresAt: number };

export function yahooAuthorizeUrl(clientId: string): string {
  const p = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: YAHOO_REDIRECT,
    response_type: 'code',
    language: 'en-us',
  });
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

async function tokenRequest(
  clientId: string,
  clientSecret: string,
  body: Record<string, string>,
  previousRefresh?: string
): Promise<YahooTokens> {
  const res = await fetchWithTimeout(
    YAHOO_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${base64(`${clientId.trim()}:${clientSecret.trim()}`)}`,
      },
      body: new URLSearchParams({ redirect_uri: YAHOO_REDIRECT, ...body }).toString(),
    },
    { label: 'Yahoo sign-in' }
  );
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    const why = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new ProviderError(
      'yahoo',
      json.error === 'invalid_grant'
        ? 'Yahoo rejected that code or it expired. Sign in again and paste the new code.'
        : `Yahoo sign-in failed: ${why}`,
      res.status
    );
  }
  return parseTokenResponse(json, Date.now(), previousRefresh);
}

export function exchangeYahooCode(clientId: string, clientSecret: string, code: string): Promise<YahooTokens> {
  return tokenRequest(clientId, clientSecret, { grant_type: 'authorization_code', code: code.trim() });
}

export function refreshYahooToken(clientId: string, clientSecret: string, refreshToken: string): Promise<YahooTokens> {
  return tokenRequest(clientId, clientSecret, { grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken);
}
