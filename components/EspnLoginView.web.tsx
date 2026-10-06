/** Browsers don't let a page read another site's cookies: ESPN sign-in is phone-only. */
export function EspnLoginView(_: { onCookies: (c: { espnS2: string; swid: string }) => void }) {
  return null;
}

export const espnLoginSupported = false;
