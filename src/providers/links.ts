/**
 * Where to fix things: a link to this team on the provider's own site, which
 * the provider's app opens instead when it is installed.
 *
 * 128BIT FANTASY stays read-only. When the lineup check finds a problem, this
 * is the one tap to go and fix it where changes are allowed.
 */
import type { League, Sport } from '@/src/sports/models';

const ESPN_GAME: Record<Sport, string> = { nfl: 'football', nba: 'basketball', mlb: 'baseball', nhl: 'hockey' };
const YAHOO: Record<Sport, [string, string]> = {
  nfl: ['football', 'f1'],
  nba: ['basketball', 'nba'],
  mlb: ['baseball', 'b1'],
  nhl: ['hockey', 'hockey'],
};

/** Yahoo keys look like "461.l.12345" and "461.l.12345.t.3". */
function yahooNum(key: string, marker: 'l' | 't'): string | null {
  const m = key.match(new RegExp(`\\.${marker}\\.(\\d+)`));
  return m ? m[1] : null;
}

export function teamUrl(league: League, teamId: string | null): string {
  const id = encodeURIComponent(league.id);
  const team = teamId ? encodeURIComponent(teamId) : null;
  switch (league.provider) {
    case 'sleeper':
      // Sleeper opens the signed-in user's own team from here.
      return `https://sleeper.com/leagues/${id}/team`;
    case 'yahoo': {
      const [sub, code] = YAHOO[league.sport];
      const l = yahooNum(league.id, 'l');
      const t = teamId ? yahooNum(teamId, 't') : null;
      if (!l) return `https://${sub}.fantasysports.yahoo.com/`;
      return `https://${sub}.fantasysports.yahoo.com/${code}/${l}${t ? `/${t}` : ''}`;
    }
    case 'espn':
      return `https://fantasy.espn.com/${ESPN_GAME[league.sport]}/team?leagueId=${id}${team ? `&teamId=${team}` : ''}&seasonId=${league.season}`;
    case 'fantrax':
      return team
        ? `https://www.fantrax.com/fantasy/league/${id}/team/roster;teamId=${team}`
        : `https://www.fantrax.com/fantasy/league/${id}/home`;
    case 'fleaflicker':
      return `https://www.fleaflicker.com/${league.sport}/leagues/${id}${team ? `/teams/${team}` : ''}`;
    case 'mfl':
      return `https://www.myfantasyleague.com/${league.season}/home/${id}`;
  }
}
