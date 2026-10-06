/**
 * The app's own 128BIT LEAGUES server, baked into release builds.
 *
 * The APK workflow passes the Project URL and publishable key in from the
 * repo's Actions variables (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY). Both
 * are meant to be public — row-level security and the database functions
 * decide what anyone can do. Without them, people connect their own
 * project as before.
 */
export type HostedProject = { url: string; anonKey: string };

export function defaultHostedProject(): HostedProject | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}
