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
  must(await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } }));
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const sb = await hosted();
  must(await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' }));
}

/** Who's signed in, in words. */
export async function whoAmI(): Promise<{ id: string; label: string } | null> {
  const sb = await hosted();
  const { data } = await sb.auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  return { id: u.id, label: u.email ?? (u.is_anonymous ? 'Quick account on this phone' : u.id.slice(0, 8)) };
}

export async function signOutHosted(): Promise<void> {
  const sb = await hosted();
  await sb.auth.signOut();
}
