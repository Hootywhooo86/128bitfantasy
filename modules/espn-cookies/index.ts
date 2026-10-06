import { requireOptionalNativeModule } from 'expo';

type Native = { get(url: string): Promise<string>; expire(url: string, name: string): Promise<void> };

const native = requireOptionalNativeModule<Native>('EspnCookies');

/** Whether this build can read the WebView's cookies (Android phone builds). */
export const cookiesAvailable = !!native;

/** The cookies the WebView holds for a URL, by name. */
export async function getCookies(url: string): Promise<Record<string, string>> {
  if (!native) return {};
  const raw = await native.get(url);
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function expireCookie(url: string, name: string): Promise<void> {
  await native?.expire(url, name);
}
