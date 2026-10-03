/**
 * Player catalogs, cached for a day.
 *
 * Sleeper's NFL catalog is ~14 MB and Sleeper asks apps to fetch it at most
 * once a day. It is trimmed to the four fields the app reads before it is
 * stored, which takes it to a tenth of that.
 */
import { getJson } from '@/src/providers/http';
import { fantraxPlayersUrl, type FantraxPlayers } from '@/src/providers/fantrax/adapter';
import { exportUrl, toMflPlayers, type MflPlayers } from '@/src/providers/mfl/adapter';
import { sleeper, type SleeperPlayers, type SleeperSport } from '@/src/providers/sleeper/client';
import type { Sport } from '@/src/sports/models';
import { getJsonItem, setJsonItem } from './kv';

const DAY = 24 * 60 * 60 * 1000;

export { cached };

type Cached<T> = { at: number; data: T };

async function cached<T>(key: string, load: () => Promise<T>, maxAge = DAY): Promise<T> {
  const hit = await getJsonItem<Cached<T>>(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.data;
  try {
    const data = await load();
    await setJsonItem(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    // Offline: a stale catalog beats player ids with no names.
    if (hit) return hit.data;
    throw e;
  }
}

export function trimSleeperPlayers(all: SleeperPlayers): SleeperPlayers {
  const out: SleeperPlayers = {};
  for (const [id, p] of Object.entries(all)) {
    out[id] = {
      full_name: p.full_name ?? ([p.first_name, p.last_name].filter(Boolean).join(' ') || null),
      position: p.position ?? null,
      team: p.team ?? null,
      injury_status: p.injury_status ?? null,
      // Kept only when set, so healthy players cost nothing.
      ...(p.injury_body_part ? { injury_body_part: p.injury_body_part } : {}),
      ...(p.injury_notes ? { injury_notes: p.injury_notes } : {}),
      ...(p.practice_participation ? { practice_participation: p.practice_participation } : {}),
      ...(p.espn_id ? { espn_id: p.espn_id } : {}),
    };
  }
  return out;
}

export function sleeperPlayers(sport: SleeperSport, signal?: AbortSignal): Promise<SleeperPlayers> {
  return cached(`players_sleeper_v2_${sport}`, async () => trimSleeperPlayers(await sleeper.players(sport, { signal })));
}

export function fantraxPlayers(sport: Sport, signal?: AbortSignal): Promise<FantraxPlayers> {
  return cached(`players_fantrax_${sport}`, async () => {
    const raw = await getJson<Record<string, { name?: string; team?: string; position?: string }>>(
      'fantrax',
      fantraxPlayersUrl(sport),
      { signal, timeoutMs: 60_000, label: 'Fantrax player list' }
    );
    const out: FantraxPlayers = {};
    for (const [id, p] of Object.entries(raw ?? {})) out[id] = { name: p.name, team: p.team, position: p.position };
    return out;
  });
}

export function mflPlayers(season: number, signal?: AbortSignal): Promise<MflPlayers> {
  return cached(`players_mfl_${season}`, async () =>
    toMflPlayers(await getJson('mfl', exportUrl(season, 'players'), { signal, timeoutMs: 60_000, label: 'MFL player list' }))
  );
}
