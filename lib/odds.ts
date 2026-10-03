/**
 * Odds on the phone: the 21+ switch, and cached reads of ESPN's free feeds.
 *
 * Off until the user turns it on and confirms they are 21 or older. Nothing
 * odds-related is fetched or shown while it is off.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getJson } from '@/src/providers/http';
import { corePath, ESPN_SPORT_PATH, parseProps, parseScoreboard, type GameOdds, type PlayerProps } from '@/src/betting/odds';
import type { Sport } from '@/src/sports/models';
import { getString, setString } from './storage/kv';
import { cached } from './storage/player-cache';

const KEY = 'odds_enabled_v1';
const TEN_MIN = 10 * 60 * 1000;
/** The scoreboard also drives live game status, so it goes stale fast. */
const TWO_MIN = 2 * 60 * 1000;

export const RESPONSIBLE_GAMING = {
  line: 'Gambling problem? Call 1-800-GAMBLER. 21+ and present in a state where sports betting is legal.',
  url: 'https://www.1800gambler.net/',
};

let enabled = false;
let loaded = false;
const listeners = new Set<() => void>();

export async function loadOddsSetting(): Promise<boolean> {
  if (!loaded) {
    enabled = (await getString(KEY)) === '1';
    loaded = true;
    for (const l of [...listeners]) l();
  }
  return enabled;
}

/** Turning on is only allowed with the 21+ confirmation — the caller asks first. */
export async function setOddsEnabled(on: boolean, confirmed21: boolean): Promise<void> {
  if (on && !confirmed21) return;
  enabled = on;
  for (const l of [...listeners]) l();
  await setString(KEY, on ? '1' : '0');
}

export function useOddsEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
    () => enabled
  );
}

export function slateOdds(sport: Sport): Promise<GameOdds[]> {
  return cached(
    `odds_scoreboard_${sport}`,
    async () =>
      parseScoreboard(
        await getJson('espn', `https://site.api.espn.com/apis/site/v2/sports/${ESPN_SPORT_PATH[sport]}/scoreboard`, { label: 'Scoreboard' })
      ),
    TWO_MIN
  );
}

/** Player lines for one game, keyed by ESPN athlete id. */
export async function gameProps(sport: Sport, eventId: string): Promise<Map<string, PlayerProps>> {
  const base = `https://sports.core.api.espn.com/v2/sports/${corePath(sport)}/events/${eventId}/competitions/${eventId}/odds`;
  const raw = await cached(
    `odds_props_${sport}_${eventId}`,
    async () => {
      const list = await getJson<{ items?: { provider?: { id?: string } }[] }>('espn', `${base}?lang=en&region=us`, { label: 'Odds' });
      const provider = list.items?.[0]?.provider?.id;
      if (!provider) return { items: [] };
      return getJson('espn', `${base}/${provider}/propBets?lang=en&region=us&limit=1000`, { label: 'Player lines', timeoutMs: 30_000 });
    },
    TEN_MIN
  );
  return parseProps(raw);
}

/**
 * This week's (or today's) real games, for live status beside each player.
 * Scores and kickoff times only — no odds are shown from this unless odds
 * are switched on.
 */
export function useSlate(sport: Sport | undefined, refreshKey: unknown = null): GameOdds[] {
  const [games, setGames] = useState<GameOdds[]>([]);
  useEffect(() => {
    if (!sport) return;
    let live = true;
    slateOdds(sport).then((g) => live && setGames(g), () => undefined);
    return () => {
      live = false;
    };
  }, [sport, refreshKey]);
  return games;
}
