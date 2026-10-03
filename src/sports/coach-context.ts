/**
 * The league context Coaches Corner sends to the model.
 *
 * Plain text, built only from what the provider returned. Nothing is filled
 * in: an unknown injury is left out, not written as "healthy", and missing
 * points are "—", not 0. The model is told to check the web for the rest.
 */
import { providerLabel } from '@/src/providers/http';
import {
  formatRecord,
  myMatchup,
  sides,
  type LeagueSnapshot,
  type Roster,
  type RosterPlayer,
  type Team,
} from './models';

export type CornerMode = 'lineup' | 'waivers' | 'trade' | 'ask';

export const CORNER_MODES: { id: CornerMode; label: string; blurb: string }[] = [
  { id: 'lineup', label: 'START / SIT', blurb: 'Best lineup for this week' },
  { id: 'waivers', label: 'WAIVER WIRE', blurb: 'Who to add, who to drop' },
  { id: 'trade', label: 'TRADE TALK', blurb: 'Where your roster is thin' },
  { id: 'ask', label: 'ASK COACH', blurb: 'Anything else' },
];

function playerLine(p: RosterPlayer): string {
  const bits = [p.lineupSlot ?? p.slot.toUpperCase(), p.name];
  const meta = [p.position, p.proTeam].filter(Boolean).join(', ');
  if (meta) bits.push(`(${meta})`);
  if (p.injury) bits.push(`[${p.injury}]`);
  return `- ${bits.join(' ')}`;
}

function rosterBlock(title: string, r: Roster | undefined): string[] {
  if (!r || r.players.length === 0) return [`${title}: roster not available`];
  const order: RosterPlayer['slot'][] = ['starter', 'bench', 'ir', 'taxi'];
  const sorted = [...r.players].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
  return [`${title}:`, ...sorted.map(playerLine)];
}

function teamLine(t: Team | undefined): string {
  if (!t) return 'unknown team';
  const pts = t.pointsFor != null ? `, ${t.pointsFor.toFixed(1)} PF` : '';
  const rank = t.rank != null ? `, #${t.rank}` : '';
  return `${t.name} (${formatRecord(t.record)}${pts}${rank})`;
}

export function buildLeagueContext(s: LeagueSnapshot): string {
  const { league } = s;
  const teams = new Map(s.teams.map((t) => [t.id, t]));
  const rosters = new Map(s.rosters.map((r) => [r.teamId, r]));
  const me = league.myTeamId;

  const lines = [
    `League: ${league.name} — ${providerLabel(league.provider)} ${league.sport.toUpperCase()} ${league.season}`,
    `Scoring: ${league.scoring ?? 'not reported'}${league.teamCount ? ` · ${league.teamCount} teams` : ''}`,
    `Period: ${s.period ?? 'season not underway'}`,
    `Data fetched: ${new Date(s.fetchedAt).toISOString()}`,
  ];

  if (!me) {
    lines.push('', 'Which team is the user\'s is unknown — ask them.');
    return lines.join('\n');
  }

  lines.push('', `My team: ${teamLine(teams.get(me))}`);
  const m = myMatchup(s);
  if (m) {
    const [mine, opp] = sides(m, me);
    const score = (p: number | null) => (p == null ? '—' : p.toFixed(1));
    if (opp) {
      lines.push(`This week vs ${teamLine(teams.get(opp.teamId))}: ${score(mine.points)} – ${score(opp.points)}`);
    } else {
      lines.push('This week: bye');
    }
    lines.push('', ...rosterBlock('My roster', rosters.get(me)));
    if (opp) lines.push('', ...rosterBlock('Opponent roster', rosters.get(opp.teamId)));
  } else {
    lines.push('', ...rosterBlock('My roster', rosters.get(me)));
  }

  const standings = [...s.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  if (standings.length) {
    lines.push('', 'Standings:', ...standings.map((t) => `${t.rank ?? '-'}. ${teamLine(t)}`));
  }
  return lines.join('\n');
}

export function cornerPrompt(mode: CornerMode, context: string, question?: string): string {
  const q = question?.trim();
  const ask: Record<CornerMode, string> = {
    lineup:
      'Set my best lineup for this period. For every starting slot say START or SIT and name who replaces anyone you bench. Check injuries, practice reports, matchups and weather first. Flag coin-flips.',
    waivers:
      'Who should I pick up and who should I drop? Look at current waiver trends and breakout usage, then rank up to five adds, each with the player on my roster I should drop for them.',
    trade:
      'Where is my roster thin and where do I have surplus? Suggest two or three realistic trade targets, and what I could offer from my roster. Use current values, not preseason ones.',
    ask: q || 'What is the one move that helps my team most right now?',
  };
  return [ask[mode], mode !== 'ask' && q ? `\nAlso: ${q}` : '', '', '--- League context ---', context]
    .filter((l) => l !== '')
    .join('\n');
}
