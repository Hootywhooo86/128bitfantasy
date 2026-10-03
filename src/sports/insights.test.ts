import { describe, expect, it } from 'vitest';
import {
  buildEspnIndex,
  buildSleeperIndex,
  injuryTag,
  insightFor,
  NEWS_FRESH_MS,
  newsAge,
  normName,
  parseEspnNews,
  projectionColumn,
} from './insights';
import type { League, RosterPlayer } from './models';

const league = (provider: League['provider'], scoring: string | null = 'PPR', sport: League['sport'] = 'nfl'): League => ({
  provider,
  id: 'L',
  name: 'L',
  sport,
  season: '2026',
  teamCount: null,
  myTeamId: null,
  scoring,
});
const pl = (id: string, name: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  id,
  name,
  position: 'WR',
  lineupSlot: 'WR',
  slot: 'starter',
  proTeam: 'MIN',
  injury: null,
  ...extra,
});

const NOW = Date.UTC(2026, 9, 3, 18);
const sleeper = buildSleeperIndex({
  '6794': { full_name: 'Justin Jefferson', team: 'MIN', injury_status: 'Out', injury_body_part: 'Ankle', practice_participation: 'DNP', espn_id: '4262921' },
  '100': { full_name: 'Mike Williams', team: 'NYJ' },
  '101': { full_name: 'Mike Williams', team: 'PIT' },
});
const espn = buildEspnIndex([
  { id: 4262921, fullName: 'Justin Jefferson', lastNewsDate: NOW - 3_600_000 },
  { id: 7, fullName: 'Old News Guy', lastNewsDate: NOW - NEWS_FRESH_MS - 1 },
  { id: 8, fullName: 'Twin Name' },
  { id: 9, fullName: 'Twin Name' },
]);
const projections = { '6794': { ppr: 17.46, half: 14.9, std: 12.3 } };

describe('player insights', () => {
  it('normalises names across providers', () => {
    expect(normName('D.K. Metcalf Jr.')).toBe('dk metcalf');
    expect(normName("Ja'Marr Chase")).toBe('jamarr chase');
    expect(normName('Amon-Ra St. Brown')).toBe('amonra st brown');
  });

  it.each([
    ['Questionable', 'Q'],
    ['DOUBTFUL', 'D'],
    ['Out', 'O'],
    ['INJURY_RESERVE', 'IR'],
    ['Injured Reserve', 'IR'],
    ['IL10', 'IL10'],
    ['SUSPENSION', 'SUS'],
    ['PUP', 'PUP'],
    ['DAY_TO_DAY', 'DTD'],
    ['ACTIVE', null],
    [null, null],
  ])('tags %s as %s', (raw, tag) => {
    expect(injuryTag(raw)).toBe(tag);
  });

  it('matches a Yahoo player by name to Sleeper detail, projection and ESPN news', () => {
    const i = insightFor(pl('y.p.1', 'Justin Jefferson'), league('yahoo'), { sleeper, projections, espn, now: NOW });
    expect(i).toMatchObject({
      tag: 'O',
      level: 'out',
      detail: 'Ankle — DNP practice',
      projection: 17.5,
      projectionSource: 'Sleeper',
      espnId: '4262921',
      hasNews: true,
    });
  });

  it('uses the league scoring for the projection', () => {
    expect(projectionColumn('Half PPR')).toBe('half');
    expect(projectionColumn('Standard')).toBe('std');
    expect(projectionColumn(null)).toBe('ppr');
    expect(insightFor(pl('6794', 'Justin Jefferson'), league('sleeper', 'Half PPR'), { sleeper, projections, espn, now: NOW }).projection).toBe(14.9);
  });

  it('breaks a name tie by team, and refuses to guess when it can’t', () => {
    const nyj = insightFor(pl('x', 'Mike Williams', { proTeam: 'NYJ' }), league('fleaflicker'), { sleeper, projections: { '100': { ppr: 5 } }, espn, now: NOW });
    expect(nyj.projection).toBe(5);
    const unknown = insightFor(pl('x', 'Mike Williams', { proTeam: null }), league('fleaflicker'), { sleeper, projections: { '100': { ppr: 5 } }, espn, now: NOW });
    expect(unknown.projection).toBeNull();
    expect(insightFor(pl('t', 'Twin Name'), league('mfl'), { sleeper: null, projections: null, espn, now: NOW }).espnId).toBeNull();
  });

  it('prefers the provider’s own projection (ESPN) and native ids', () => {
    const i = insightFor(pl('4262921', 'Justin Jefferson', { projected: 15.2 }), league('espn'), { sleeper, projections, espn, now: NOW });
    expect(i).toMatchObject({ projection: 15.2, projectionSource: 'ESPN', espnId: '4262921' });
  });

  it('only shows the scroll for fresh news', () => {
    expect(insightFor(pl('7', 'Old News Guy'), league('espn', null, 'nba'), { sleeper: null, projections: null, espn, now: NOW }).hasNews).toBe(false);
  });

  it('gives other sports no projection rather than a guess', () => {
    const i = insightFor(pl('a', 'Justin Jefferson'), league('yahoo', null, 'nba'), { sleeper, projections, espn, now: NOW });
    expect(i.projection).toBeNull();
    expect(i.detail).toBeNull(); // Sleeper's NFL injury detail is not borrowed for another sport
  });
});

describe('news', () => {
  it('parses ESPN player news, newest first, without HTML', () => {
    const n = parseEspnNews({
      feed: [
        { id: 1, headline: 'Older', published: '2026-10-01T10:00:00Z', type: 'Rotowire' },
        { id: 2, headline: 'Jefferson (ankle) ruled out', story: '<p>Minor sprain.</p>', published: '2026-10-03T13:33:00Z', type: 'Rotowire' },
        { id: 3, headline: '', published: '2026-10-03T14:00:00Z' },
      ],
    });
    expect(n.map((x) => x.id)).toEqual(['2', '1']);
    expect(n[0]).toMatchObject({ story: 'Minor sprain.', source: 'Rotowire' });
    expect(parseEspnNews({ code: 1008 })).toEqual([]);
  });

  it('says how old a story is', () => {
    expect(newsAge('2026-10-03T13:00:00Z', NOW)).toBe('5h ago');
    expect(newsAge('2026-09-30T13:00:00Z', NOW)).toBe('3d ago');
  });
});
