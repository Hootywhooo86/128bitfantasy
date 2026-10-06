/**
 * ESPN lineup changes — UNOFFICIAL, and only when the user has switched ESPN
 * to READ & WRITE in Settings.
 *
 * This is the same request the ESPN website sends when you drag a player into
 * your lineup, made with your own login cookies. ESPN doesn't document or
 * support it, can change it any week, and its terms don't allow automated
 * access; the switch says all of that before it turns on.
 */
import type { League, Sport } from '@/src/sports/models';
import { ProviderError } from '../types';
import { normalizeSwid, SLOTS } from './adapter';
import { espnCookie, ESPN_BASE, ESPN_GAME, type EspnLeague } from './client';
import { fetchWithTimeout } from '@/lib/net';

export const ESPN_WRITE_BASE = 'https://lm-api-writes.fantasy.espn.com/apis/v3/games';

export const BENCH_SLOT: Record<Sport, number> = { nfl: 20, nba: 12, nhl: 7, mlb: 16 };

/** "FLEX" → 23 for this sport (bench and IR included). */
export function slotIdFor(sport: Sport, label: string): number | null {
  for (const [id, l] of Object.entries(SLOTS[sport])) if (l === label) return Number(id);
  return null;
}

export type LineupItem = { playerId: number; type: 'LINEUP'; fromLineupSlotId: number; toLineupSlotId: number };

type Entry = { playerId: number; lineupSlotId: number; eligible: number[] };

/**
 * The moves for "start `inId` in `slotLabel`", benching `outId` if given.
 * Throws a sentence when ESPN wouldn't allow it.
 */
export function lineupItems(sport: Sport, entries: Entry[], inId: string, outId: string | null, slotLabel: string): LineupItem[] {
  const bench = BENCH_SLOT[sport];
  const incoming = entries.find((e) => String(e.playerId) === inId);
  if (!incoming) throw new Error('That player is no longer on your team.');
  const outgoing = outId ? entries.find((e) => String(e.playerId) === outId) : null;
  if (outId && !outgoing) throw new Error('The starter has already moved — refresh and try again.');
  const target = outgoing ? outgoing.lineupSlotId : slotIdFor(sport, slotLabel);
  if (target == null) throw new Error(`ESPN has no ${slotLabel} spot this app knows how to fill.`);
  if (incoming.eligible.length && !incoming.eligible.includes(target)) {
    throw new Error(`ESPN won't let him play ${SLOTS[sport][target] ?? slotLabel}.`);
  }
  const items: LineupItem[] = [];
  if (outgoing) items.push({ playerId: outgoing.playerId, type: 'LINEUP', fromLineupSlotId: outgoing.lineupSlotId, toLineupSlotId: bench });
  items.push({ playerId: incoming.playerId, type: 'LINEUP', fromLineupSlotId: incoming.lineupSlotId, toLineupSlotId: target });
  return items;
}

/** Start a bench player (benching the starter if there is one). */
export async function espnStart(
  conn: { espnS2: string | null; swid: string | null },
  league: League,
  teamId: string,
  inId: string,
  outId: string | null,
  slotLabel: string
): Promise<void> {
  const cookie = espnCookie(conn.espnS2, conn.swid);
  if (!cookie) throw new ProviderError('espn', 'Sign in to ESPN first (Settings → ESPN → SIGN IN WITH ESPN).');
  const sport = league.sport;
  const leagueUrl = `${ESPN_GAME[sport]}/seasons/${league.season}/segments/0/leagues/${encodeURIComponent(league.id)}`;
  // Fresh roster: slots must match what ESPN has right now, not our cached copy.
  const res = await fetchWithTimeout(`${ESPN_BASE}/${leagueUrl}?view=mRoster&view=mStatus`, { headers: { Cookie: cookie, Accept: 'application/json' } }, { label: 'ESPN roster' });
  if (!res.ok) throw new ProviderError('espn', `ESPN didn't send your roster (HTTP ${res.status}). Sign in again.`, res.status);
  const raw = (await res.json()) as EspnLeague;
  const team = raw.teams?.find((t) => String(t.id) === teamId);
  const entries: Entry[] = (team?.roster?.entries ?? []).map((e) => ({
    playerId: e.playerId,
    lineupSlotId: e.lineupSlotId,
    eligible: e.playerPoolEntry?.player?.eligibleSlots ?? [],
  }));
  const items = lineupItems(sport, entries, inId, outId, slotLabel);
  const body = {
    isLeagueManager: false,
    teamId: Number(teamId),
    type: 'ROSTER',
    memberId: normalizeSwid(conn.swid),
    scoringPeriodId: raw.scoringPeriodId,
    executionType: 'EXECUTE',
    items,
  };
  const w = await fetchWithTimeout(
    `${ESPN_WRITE_BASE}/${leagueUrl}/transactions/`,
    {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Fantasy-Source': 'kona', 'X-Fantasy-Platform': 'kona' },
      body: JSON.stringify(body),
    },
    { label: 'ESPN lineup change' }
  );
  if (!w.ok) {
    const text = await w.text().catch(() => '');
    let why = '';
    try {
      const j = JSON.parse(text) as { messages?: string[]; details?: { message?: string }[] };
      why = j.messages?.join(' ') || j.details?.map((d) => d.message).filter(Boolean).join(' ') || '';
    } catch {
      why = text.replace(/<[^>]+>/g, ' ').trim().slice(0, 140);
    }
    throw new ProviderError(
      'espn',
      `ESPN refused the change (HTTP ${w.status})${why ? `: ${why}` : ''}. His game may have started, or ESPN changed how this works — make it on espn.com.`,
      w.status
    );
  }
}
