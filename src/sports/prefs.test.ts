import { describe, expect, it } from 'vitest';
import { normalizeHex, onAccentFor, tooDark } from '@/lib/accent';
import type { League } from './models';
import { EMPTY_PREFS, needsTeamPick, pickTeam, toggleHidden, visibleOnHome } from './prefs';

const lg = (id: string, myTeamId: string | null): League => ({
  provider: 'espn',
  id,
  name: id,
  sport: 'nfl',
  season: '2026',
  teamCount: 10,
  myTeamId,
  scoring: null,
});

describe('league prefs', () => {
  const leagues = [lg('a', '1'), lg('b', null), lg('c', '3')];

  it('shows only leagues with a known team of yours', () => {
    expect(visibleOnHome(leagues, EMPTY_PREFS).map((l) => l.id)).toEqual(['a', 'c']);
    expect(needsTeamPick(leagues, EMPTY_PREFS).map((l) => l.id)).toEqual(['b']);
  });

  it('a picked team brings the league onto Home', () => {
    const p = pickTeam(EMPTY_PREFS, 'espn:b', '7');
    const v = visibleOnHome(leagues, p);
    expect(v.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(v[1].myTeamId).toBe('7');
    expect(needsTeamPick(leagues, p)).toEqual([]);
  });

  it('hiding removes a league from Home and from the to-do list', () => {
    const p = toggleHidden(toggleHidden(EMPTY_PREFS, 'espn:a', true), 'espn:b', true);
    expect(visibleOnHome(leagues, p).map((l) => l.id)).toEqual(['c']);
    expect(needsTeamPick(leagues, p)).toEqual([]);
    expect(visibleOnHome(leagues, toggleHidden(p, 'espn:a', false)).map((l) => l.id)).toEqual(['a', 'c']);
  });
});

describe('accent', () => {
  it('accepts any hex, short or long, with or without #', () => {
    expect(normalizeHex('FFF')).toBe('#ffffff');
    expect(normalizeHex('#26D3C3')).toBe('#26d3c3');
    expect(normalizeHex('blue')).toBeNull();
  });

  it('picks readable text and refuses colours that vanish on black', () => {
    expect(onAccentFor('#c4cad3')).toBe('#000000');
    expect(onAccentFor('#5b21b6')).toBe('#ffffff');
    expect(tooDark('#101010')).toBe(true);
    expect(tooDark('#c4cad3')).toBe(false);
  });
});
