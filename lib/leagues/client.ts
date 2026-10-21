/**
 * The Supabase connection behind 128BIT LEAGUES.
 *
 * Bring-your-own project, like the AI key: the commissioner makes a free
 * Supabase project, runs supabase/schema.sql in it, and shares the Project
 * URL and publishable (anon) key with the league. That key is meant to be
 * public — row-level security decides what each person can read or change.
 *
 * Sign-in is either a quick anonymous account (this phone only) or an email
 * code, which keeps your team when you change phones.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConnection, saveConnection } from '@/lib/storage/connections';
import { getString, removeItem, setString } from '@/lib/storage/kv';
import type { Connection } from '@/src/providers/types';

export type HostedConn = Extract<Connection, { provider: 'bit128' }>;

let current: { key: string; client: SupabaseClient } | null = null;

/** Where Supabase keeps the login: the app's SQLite store, not the keystore (sessions outgrow its 2 KB). */
const authStorage = {
  getItem: (k: string) => getString(k),
  setItem: (k: string, v: string) => setString(k, v),
  removeItem: (k: string) => removeItem(k),
};

/** "abcd.supabase.co", "https://abcd.supabase.co/" or just "abcd" → the project URL. */
export function normalizeProjectUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^[a-z0-9]{10,}$/i.test(s)) s = `${s}.supabase.co`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/rest\/v1$/, '');
}

export function clientFor(conn: Pick<HostedConn, 'url' | 'anonKey'>): SupabaseClient {
  const key = `${conn.url}|${conn.anonKey}`;
  if (current?.key === key) return current.client;
  const client = createClient(conn.url, conn.anonKey, {
    auth: { storage: authStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  current = { key, client };
  return client;
}

export async function hostedConn(): Promise<HostedConn | null> {
  return getConnection('bit128');
}

/** The client for the saved project, or a sentence saying what to set up. */
export async function hosted(): Promise<SupabaseClient> {
  const c = await hostedConn();
  if (!c) throw new Error('Set up 128BIT LEAGUES in Settings first.');
  return clientFor(c);
}

export async function saveHostedConn(url: string, anonKey: string): Promise<HostedConn> {
  const conn: HostedConn = { provider: 'bit128', url: normalizeProjectUrl(url), anonKey: anonKey.trim() };
  await saveConnection(conn);
  return conn;
}

/** Supabase errors come back as values; this turns one into a sentence. */
export function sbMessage(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/anonymous sign-ins are disabled/i.test(m)) {
    return 'Quick sign-in is off for this project. In Supabase: Authentication → Sign In / Providers → turn on "Allow anonymous sign-ins". Or use an email code.';
  }
  if (/function .* does not exist|relation .* does not exist|Could not find the function/i.test(m)) {
    return 'This Supabase project has no 128BIT LEAGUES tables yet. Run supabase/schema.sql in its SQL Editor (see the setup steps).';
  }
  if (/Invalid API key|No API key/i.test(m)) return 'Supabase did not accept that key. Copy the publishable (anon) key again from Project Settings → API Keys.';
  if (/expired|invalid/i.test(m) && /token|otp|link/i.test(m)) {
    return 'That code or link has expired or was already used (opening the link uses it up). Tap EMAIL ME A CODE for a new one, and paste the link here without opening it.';
  }
  if (/invalid login credentials/i.test(m)) return 'That email and password don\'t match a 128bit account. Use the password from your other 128bit apps.';
  if (/user already registered/i.test(m)) return 'There\'s already a 128bit account with that email — tap SIGN IN instead.';
  if (/password should be|weak password/i.test(m)) return 'Pick a longer password (at least 6 characters).';
  if (/rate limit/i.test(m)) return 'Supabase is limiting emails right now (the free email service sends only a few an hour). Try quick sign-in, or wait and try again.';
  return m;
}

/** Throws the sentence when a Supabase call came back with an error. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(sbMessage(res.error));
  return res.data;
}

export async function currentUserId(): Promise<string | null> {
  const sb = await hosted();
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function signInQuick(): Promise<void> {
  const sb = await hosted();
  must(await sb.auth.signInAnonymously());
}

export async function sendEmailCode(email: string): Promise<void> {
  const sb = await hosted();
  must(await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: AUTH_REDIRECT } }));
}

/** Where the emailed sign-in link sends people: back into this app. */
export const AUTH_REDIRECT = 'bitfantasy://auth';

export type LinkResult =
  | { kind: 'token'; tokenHash: string; type: 'email' | 'magiclink' | 'signup' }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

/**
 * What a pasted (or opened) sign-in link carries:
 * - the email's own link, ".../auth/v1/verify?token=…&type=magiclink" — not yet used;
 * - where that link lands after it's opened, "…#access_token=…&refresh_token=…"
 *   (localhost:3000 on a project with the default Site URL, or this app);
 * - or the error it lands on when it was already used.
 * Gmail and other apps may wrap links in their own redirect, so the text is
 * decoded until nothing changes.
 */
export function readAuthLink(input: string): LinkResult | null {
  let s = input.trim();
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  const param = (k: string) => s.match(new RegExp(`[?&#]${k}=([^&#\\s]+)`))?.[1];
  const access = param('access_token');
  const refresh = param('refresh_token');
  if (access && refresh) return { kind: 'session', accessToken: access, refreshToken: refresh };
  const err = param('error_description') ?? param('error_code') ?? param('error');
  if (err) {
    const used = /expired|invalid|not.?found/i.test(err);
    return {
      kind: 'error',
      message: used
        ? 'That link was already used or has expired — each one works once. Tap EMAIL ME A CODE for a new one.'
        : `Supabase said: ${err.replace(/\+/g, ' ')}`,
    };
  }
  const token = param('token_hash') ?? param('token');
  if (!token || !/verify|token_hash/.test(s)) return null;
  const t = param('type');
  return { kind: 'token', tokenHash: token, type: t === 'signup' || t === 'magiclink' ? t : 'email' };
}

/** Signs in from a link (pasted, or opened into the app). Throws the reason when it can't. */
export async function signInFromLink(input: string): Promise<boolean> {
  const r = readAuthLink(input);
  if (!r) return false;
  if (r.kind === 'error') throw new Error(r.message);
  const sb = await hosted();
  if (r.kind === 'session') must(await sb.auth.setSession({ access_token: r.accessToken, refresh_token: r.refreshToken }));
  else must(await sb.auth.verifyOtp({ token_hash: r.tokenHash, type: r.type }));
  return true;
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  if (await signInFromLink(code)) return;
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(digits)) {
    throw new Error('Enter the 6-digit code from the email, or paste the whole link (or the address the link opened).');
  }
  const sb = await hosted();
  must(await sb.auth.verifyOtp({ email: email.trim(), token: digits, type: 'email' }));
}

/** Your 128bit account: the same email and password as the other 128bit apps on this project. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const sb = await hosted();
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(sbMessage(error));
}

/**
 * A new 128bit account. Returns false when the project wants the email
 * confirmed first (the email's link then opens this app).
 */
export async function createAccount(email: string, password: string): Promise<boolean> {
  const sb = await hosted();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: AUTH_REDIRECT } });
  if (error) throw new Error(sbMessage(error));
  return !!data.session;
}

/** Who's signed in, in words. */
export async function whoAmI(): Promise<{ id: string; label: string } | null> {
  const sb = await hosted();
  const { data } = await sb.auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  return { id: u.id, label: u.email ?? (u.is_anonymous ? 'Quick account on this phone' : u.id.slice(0, 8)) };
}

/**
 * Deletes the account and everything that's only yours. Your teams in
 * leagues that have started stay (marked "left") so friends can finish the
 * season; leagues you run pass to another member.
 */
export async function deleteHostedAccount(): Promise<void> {
  const sb = await hosted();
  must(await sb.rpc('delete_my_account'));
  await sb.auth.signOut().catch(() => undefined);
}

export async function signOutHosted(): Promise<void> {
  const sb = await hosted();
  await sb.auth.signOut();
}
