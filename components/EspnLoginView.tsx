import CookieManager from '@react-native-cookies/cookies';
import React, { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';

const LOGIN_URL = 'https://www.espn.com/login';

/**
 * ESPN's own sign-in page. Watches the phone's cookie store and reports
 * espn_s2 + SWID the moment ESPN sets them. Never reads the page itself.
 */
export function EspnLoginView({ onCookies }: { onCookies: (c: { espnS2: string; swid: string }) => void }) {
  const done = useRef(false);
  useEffect(() => {
    // An old ESPN session would be picked up as this one; start clean.
    CookieManager.clearByName('https://www.espn.com', 'espn_s2', true).catch(() => undefined);
    const t = setInterval(async () => {
      if (done.current) return;
      try {
        const jar = await CookieManager.get('https://www.espn.com', true);
        const s2 = jar.espn_s2?.value;
        const swid = jar.SWID?.value;
        if (s2 && swid) {
          done.current = true;
          onCookies({ espnS2: decodeURIComponent(s2), swid: decodeURIComponent(swid) });
        }
      } catch {
        // Not signed in yet.
      }
    }, 1500);
    return () => clearInterval(t);
  }, [onCookies]);

  return <WebView source={{ uri: LOGIN_URL }} sharedCookiesEnabled thirdPartyCookiesEnabled style={{ flex: 1 }} />;
}

export const espnLoginSupported = true;
