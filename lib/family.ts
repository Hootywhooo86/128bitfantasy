/**
 * The 128bit family account: one sign-in across 128bitPlay, 128bitfit, 128bit
 * Tracker and the rest (Google, Apple or email). Signed in, results and lineup
 * fixes (lib/family-events.ts) go to the family feed, so they show on Tracker's
 * timeline and earn XP in 128bitlife.
 *
 * Separate from 128BIT LEAGUES' own sign-in (lib/leagues), which belongs to a
 * league's server. Offline-safe: events wait in an outbox. Nothing is
 * collected while signed out.
 */
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { FantasyEvent } from '@/src/sports/events';
import { toFamilyEvents, type FamilyFeedEvent } from './family-events';
import { getJsonItem, setJsonItem } from './storage/kv';
import { deleteSecret, getSecret, setSecret } from './storage/secure';

/** The 128bit family project. Its publishable key is meant to ship inside apps. */
export const FAMILY_PROJECT = {
  url: 'https://wvflpwtaszpstmjpkrhu.supabase.co',
  key: 'sb_publishable_dO8uP74cTV1tbuqESgxysw_323C7lWh',
};

const SESSION_KEY = 'family_session_v1';
const OUTBOX_KEY = 'family_outbox_v1';
const AUTH_CALLBACK = 'bitfantasy://auth-callback';

type Session = { access: string; refresh: string; expires: number; email: string };

const listeners = new Set<() => void>();
export function onFamily(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function readSession(): Promise<Session | null> {
  try {
    const raw = await getSecret(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

async function writeSession(s: Session | null): Promise<void> {
  if (s) await setSecret(SESSION_KEY, JSON.stringify(s));
  else await deleteSecret(SESSION_KEY);
  for (const l of [...listeners]) l();
}

export async function familyEmail(): Promise<string | null> {
  return (await readSession())?.email ?? null;
}

async function call(path: string, body: unknown, token?: string): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(FAMILY_PROJECT.url + path, {
      method: 'POST',
      headers: {
        apikey: FAMILY_PROJECT.key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach the 128bit family account. Check the connection.');
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    throw new Error(String(json?.error_description ?? json?.msg ?? json?.message ?? `The account service answered ${res.status}`));
  }
  return json;
}

function toSession(a: Record<string, unknown> | null, email = ''): Session {
  const user = a?.user as { email?: string } | undefined;
  if (!a?.access_token || !a.refresh_token) throw new Error('Sign-in failed.');
  return {
    access: String(a.access_token),
    refresh: String(a.refresh_token),
    expires: Number(a.expires_at ?? Math.floor(Date.now() / 1000) + Number(a.expires_in ?? 3600)),
    email: user?.email ?? email,
  };
}

async function token(): Promise<string | null> {
  const s = await readSession();
  if (!s) return null;
  if (s.expires - 60 > Date.now() / 1000) return s.access;
  try {
    const fresh = toSession(await call('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh }), s.email);
    await writeSession(fresh);
    return fresh.access;
  } catch (e) {
    if (e instanceof Error && /invalid|not found|revoked|expired/i.test(e.message)) await writeSession(null);
    throw e;
  }
}

export async function signInEmail(email: string, password: string): Promise<void> {
  await writeSession(toSession(await call('/auth/v1/token?grant_type=password', { email: email.trim(), password }), email.trim()));
  void flushFamily();
}

/** False when the email has to be confirmed first. */
export async function signUpEmail(email: string, password: string): Promise<boolean> {
  const a = await call('/auth/v1/signup', { email: email.trim(), password });
  if (!a?.access_token) return false;
  await writeSession(toSession(a, email.trim()));
  return true;
}

/**
 * Google / Apple through Supabase's sign-in page in an in-app browser, back
 * through bitfantasy://auth-callback. PKCE (S256): a code caught by another
 * app is useless without the verifier that never leaves this one.
 */
export async function signInWith(provider: 'google' | 'apple'): Promise<void> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const verifier = Array.from(Crypto.getRandomBytes(64), (b) => chars[b % chars.length]).join('');
  const challenge = (
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const result = await WebBrowser.openAuthSessionAsync(
    `${FAMILY_PROJECT.url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(AUTH_CALLBACK)}` +
      `&code_challenge=${challenge}&code_challenge_method=s256`,
    AUTH_CALLBACK,
  );
  if (result.type !== 'success') throw new Error('Sign-in was cancelled.');
  const back = new URL(result.url);
  const code = back.searchParams.get('code');
  if (!code) throw new Error(back.searchParams.get('error_description') ?? 'Sign-in was refused.');
  await writeSession(toSession(await call('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier })));
  void flushFamily();
}

/** Signs out and drops anything not yet sent. */
export async function signOutFamily(): Promise<void> {
  await setJsonItem(OUTBOX_KEY, []);
  await writeSession(null);
}

/** Deletes the 128bit family account and what every 128bit app stored in it. Leagues are untouched. */
export async function deleteFamilyAccount(): Promise<void> {
  const t = await token();
  if (!t) throw new Error('Sign in first.');
  await call('/rest/v1/rpc/delete_my_account', {}, t);
  await signOutFamily();
}

// --- Outbox -----------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let sending: Promise<void> | null = null;

/** Queues the feed-worthy ones among new fantasy events. Never throws. */
export function sendToFamily(events: readonly FantasyEvent[]): void {
  const out = toFamilyEvents(events);
  if (!out.length) return;
  void (async () => {
    if (!(await readSession())) return;
    const q = (await getJsonItem<FamilyFeedEvent[]>(OUTBOX_KEY)) ?? [];
    const ids = new Set(out.map((e) => e.id));
    await setJsonItem(OUTBOX_KEY, [...q.filter((e) => !ids.has(e.id)), ...out].slice(-500));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flushFamily();
    }, 3000);
  })().catch(() => undefined);
}

/** Sends what's waiting; keeps it for later when offline. */
export function flushFamily(): Promise<void> {
  sending ??= (async () => {
    const q = (await getJsonItem<FamilyFeedEvent[]>(OUTBOX_KEY)) ?? [];
    if (!q.length) return;
    const t = await token();
    if (!t) return;
    const batch = q.slice(0, 100);
    await call('/rest/v1/rpc/log_events', { events: batch }, t);
    const sent = new Set(batch.map((e) => e.id));
    const rest = ((await getJsonItem<FamilyFeedEvent[]>(OUTBOX_KEY)) ?? []).filter((e) => !sent.has(e.id));
    await setJsonItem(OUTBOX_KEY, rest);
    if (rest.length) setTimeout(() => void flushFamily(), 0);
  })()
    .catch(() => undefined)
    .finally(() => {
      sending = null;
    });
  return sending;
}
