/**
 * Which fantasy events go to the 128bit family feed, and in what shape.
 *
 * Results and lineup fixes are facts worth keeping on Tracker's timeline and
 * worth XP in 128bitlife. Lineup problems and bench nudges are in-the-moment
 * alerts that stop being true minutes later, so they stay on the phone.
 *
 * Pure: no storage, no network. Schema: 128bittracker's docs/EVENTS.md.
 */
import type { FantasyEvent } from '@/src/sports/events';

export type FamilyFeedEvent = {
  id: string;
  app: 'fantasy';
  type: string;
  at: number;
  data: Record<string, string | number | null>;
};

const SENT: ReadonlySet<FantasyEvent['type']> = new Set(['matchup.won', 'matchup.lost', 'matchup.tied', 'lineup.fixed']);

export function toFamilyEvents(events: readonly FantasyEvent[]): FamilyFeedEvent[] {
  return events
    .filter((e) => SENT.has(e.type))
    .map((e) => ({
      // Fantasy ids are stable per change, so a repeat sends the same id and the feed keeps one.
      id: `fantasy-${e.id}`,
      app: 'fantasy',
      type: e.type,
      at: e.at,
      data: {
        title: e.title,
        league: e.league.name,
        sport: e.league.sport,
        week: e.period,
        detail: e.body,
      },
    }));
}
