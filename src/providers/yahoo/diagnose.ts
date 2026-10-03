/**
 * YAHOO CHECK: walks the sign-in and the first data read one step at a time
 * and says which step fails, with what Yahoo actually answered.
 *
 * The report is safe to copy and share: it never contains the secret or a
 * token — only lengths, statuses, and the start of Yahoo's replies.
 */
import { fetchWithTimeout } from '@/lib/net';
import type { Connection } from '../types';
import { toYahooLeagues, YAHOO_API } from './adapter';
import { refreshYahooToken } from './oauth';

type YahooConn = Extract<Connection, { provider: 'yahoo' }>;

export type CheckStep = { step: string; ok: boolean; detail: string };

/** Strips anything token-shaped from text that is about to be shown or copied. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length > 6) out = out.split(s).join('•••');
  return out;
}

export function keyChecks(clientId: string, clientSecret: string): CheckStep[] {
  const id = clientId.trim();
  return [
    {
      step: 'Client ID',
      ok: id.length > 40 && id.startsWith('dj0y'),
      detail:
        id.length === 0
          ? 'missing'
          : `${id.length} characters, starts "${id.slice(0, 4)}"${id.startsWith('dj0y') ? '' : ' — Yahoo IDs start with dj0y; it may be cut off'}`,
    },
    {
      step: 'App type',
      ok: true,
      detail: clientSecret.trim() ? `Confidential (secret: ${clientSecret.trim().length} characters)` : 'Public (no secret — signs in with PKCE)',
    },
  ];
}

export async function yahooCheck(conn: YahooConn | null, clientId: string, clientSecret: string): Promise<CheckStep[]> {
  const steps = keyChecks(clientId, clientSecret);
  if (!conn) {
    steps.push({ step: 'Signed in', ok: false, detail: 'No Yahoo login saved yet — finish SIGN IN WITH YAHOO first.' });
    return steps;
  }
  const secrets = [conn.accessToken, conn.refreshToken, conn.clientSecret];
  let token = conn.accessToken;
  const mins = Math.round((conn.expiresAt - Date.now()) / 60000);
  steps.push({ step: 'Signed in', ok: true, detail: mins > 0 ? `login valid for ${mins} more min` : 'login expired — refreshing' });

  if (mins <= 0) {
    try {
      token = (await refreshYahooToken(conn.clientId, conn.clientSecret || null, conn.refreshToken)).accessToken;
      secrets.push(token);
      steps.push({ step: 'Refresh', ok: true, detail: 'Yahoo issued a new login' });
    } catch (e) {
      steps.push({ step: 'Refresh', ok: false, detail: redact(e instanceof Error ? e.message : String(e), secrets) });
      return steps;
    }
  }

  const url = `${YAHOO_API}/users;use_login=1/games;game_keys=nfl,nba,mlb,nhl/leagues?format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, { label: 'Yahoo leagues' });
    const text = await res.text();
    const type = res.headers.get('content-type') ?? '?';
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // reported below
    }
    const snippet = redact(text.replace(/\s+/g, ' ').slice(0, 220), secrets);
    if (!res.ok || !parsed) {
      steps.push({ step: 'Read leagues', ok: false, detail: `HTTP ${res.status} (${type}): ${snippet}` });
      return steps;
    }
    steps.push({ step: 'Read leagues', ok: true, detail: `HTTP ${res.status}` });
    const leagues = toYahooLeagues(parsed);
    steps.push({
      step: 'Leagues found',
      ok: leagues.length > 0,
      detail: leagues.length
        ? leagues.slice(0, 6).map((l) => `${l.name} (${l.sport.toUpperCase()} ${l.season})`).join(', ')
        : `none in the reply — Yahoo said: ${snippet}`,
    });
  } catch (e) {
    steps.push({ step: 'Read leagues', ok: false, detail: redact(e instanceof Error ? e.message : String(e), secrets) });
  }
  return steps;
}

export function reportText(steps: CheckStep[]): string {
  return ['128BIT FANTASY — Yahoo check', ...steps.map((s) => `${s.ok ? 'OK ' : 'XX '} ${s.step}: ${s.detail}`)].join('\n');
}
