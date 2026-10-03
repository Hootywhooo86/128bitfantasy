/**
 * The league context Coaches Corner sends to the model.
 *
 * Plain text, built only from what the provider returned. Nothing is filled
 * in: an unknown injury is left out, not written as "healthy", and missing
 * points are "—", not 0. The model is told to check the web for the rest.
 */
import { providerLabel } from '@/src/providers/http';
import { lineupIssues } from './lineup-check';
import {
  formatRecord,
  matchupFor,
  sides,
  type LeagueSnapshot,
  type Roster,
  type RosterPlayer,
  type Team,
} from './models';

export type CornerMode = 'lineup' | 'waivers' | 'trade' | 'grade' | 'ask';

export const CORNER_MODES: { id: CornerMode; label: string; blurb: string }[] = [
  { id: 'lineup', label: 'START / SIT', blurb: 'Best lineup for this week' },
  { id: 'waivers', label: 'WAIVER WIRE', blurb: 'Who to add, who to drop' },
  { id: 'trade', label: 'TRADE TALK', blurb: 'Where your roster is thin' },
  { id: 'grade', label: 'TRADE CHECK', blurb: 'Tap the players in a deal — the coach grades it' },
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

/**
 * Everything the coach knows about one team in one league.
 *
 * `focusTeamId` is the team on screen — usually the user's, but scouting an
 * opponent works the same way, and the coach is told which it is.
 */
export function buildLeagueContext(s: LeagueSnapshot, focusTeamId?: string | null, alsoTeamIds: string[] = []): string {
  const { league } = s;
  const teams = new Map(s.teams.map((t) => [t.id, t]));
  const rosters = new Map(s.rosters.map((r) => [r.teamId, r]));
  const me = league.myTeamId;
  const focus = focusTeamId ?? me;

  const lines = [
    `League: ${league.name} — ${providerLabel(league.provider)} ${league.sport.toUpperCase()} ${league.season}`,
    `Scoring: ${league.scoring ?? 'not reported'}${league.teamCount ? ` · ${league.teamCount} teams` : ''}`,
    `Period: ${s.period ?? 'season not underway'}`,
    `Data fetched: ${new Date(s.fetchedAt).toISOString()}`,
  ];

  if (!focus) {
    lines.push('', "Which team is the user's is unknown — ask them.");
    return lines.join('\n');
  }

  const scouting = focus !== me;
  if (scouting) {
    lines.push('', `Team being viewed: ${teamLine(teams.get(focus))} — NOT the user's team; they are scouting it.`);
    if (me) lines.push(`User's own team: ${teamLine(teams.get(me))}`);
  } else {
    lines.push('', `My team: ${teamLine(teams.get(focus))}`);
  }

  const title = scouting ? 'Viewed team roster' : 'My roster';
  const m = matchupFor(s, focus);
  if (m) {
    const [mine, opp] = sides(m, focus);
    const score = (p: number | null) => (p == null ? '—' : p.toFixed(1));
    if (opp) {
      lines.push(`This week vs ${teamLine(teams.get(opp.teamId))}: ${score(mine.points)} – ${score(opp.points)}`);
    } else {
      lines.push('This week: bye');
    }
    lines.push('', ...rosterBlock(title, rosters.get(focus)));
    if (opp) lines.push('', ...rosterBlock('Opponent roster', rosters.get(opp.teamId)));
  } else {
    lines.push('', ...rosterBlock(title, rosters.get(focus)));
  }
  const issues = lineupIssues(rosters.get(focus), league.sport);
  if (issues.length) {
    lines.push(
      '',
      'Lineup check (from provider injury statuses):',
      ...issues.map((i) => `- ${i.slot}: ${i.message}${i.options.length ? ` — healthy bench options: ${i.options.map((o) => o.name).join(', ')}` : ''}`)
    );
  }

  // Scouting someone I'm not playing: include my roster so trade ideas work.
  // (If I am their opponent, it is already listed above.)
  const facingMe = !!m && (m.home.teamId === me || m.away?.teamId === me);
  if (scouting && me && !facingMe) {
    lines.push('', ...rosterBlock('My roster (for trade ideas)', rosters.get(me)));
  }

  // Extra teams the question is about (a trade partner), unless already listed.
  const listed = new Set([focus, ...(m ? [m.home.teamId, m.away?.teamId] : []), ...(scouting && me ? [me] : [])]);
  for (const id of alsoTeamIds) {
    if (listed.has(id)) continue;
    listed.add(id);
    lines.push('', ...rosterBlock(`${teams.get(id)?.name ?? 'Other team'} roster`, rosters.get(id)));
  }

  const standings = [...s.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  if (standings.length) {
    lines.push('', 'Standings:', ...standings.map((t) => `${t.rank ?? '-'}. ${teamLine(t)}`));
  }
  return lines.join('\n');
}

/** The question for one play. The league context travels separately, in the system prompt. */
export function cornerQuestion(mode: CornerMode, question?: string, scouting = false): string {
  const q = question?.trim();
  const ask: Record<CornerMode, string> = {
    lineup: scouting
      ? "Who on this team should start this period, and where is their lineup weak that my team can exploit? Check injuries and practice reports first."
      : 'Set my best lineup for this period. For every starting slot say START or SIT and name who replaces anyone you bench. Check injuries, practice reports, matchups and weather first. Flag coin-flips.',
    waivers: scouting
      ? 'Which free agents would most help this team? Tell me which of them I should grab first to block them.'
      : 'Who should I pick up and who should I drop? Look at current waiver trends and breakout usage, then rank up to five adds, each with the player on my roster I should drop for them.',
    trade: scouting
      ? 'What does this team need, and what realistic trade could I offer them from my roster? Use current values.'
      : 'Where is my roster thin and where do I have surplus? Suggest two or three realistic trade targets, and what I could offer from my roster. Use current values, not preseason ones.',
    grade: q || 'Grade this trade.',
    ask: q || (scouting ? 'What should I know about this team?' : 'What is the one move that helps my team most right now?'),
  };
  return mode !== 'ask' && q ? `${ask[mode]}\n\nAlso: ${q}` : ask[mode];
}

/** The question for TRADE CHECK: the exact players on each side, graded from my point of view. */
export function tradeQuestion(give: string[], get: string[], partner: string, note?: string): string {
  const lines = [
    `Grade this trade for me, A to F, with one line of why. Then say ACCEPT, DECLINE or COUNTER, and if COUNTER, what to ask for.`,
    `I give: ${give.length ? give.join(', ') : 'nothing'}`,
    `I get from ${partner}: ${get.length ? get.join(', ') : 'nothing'}`,
    'Check current injuries, role and recent usage for every player in the deal first. Consider my roster needs and starting slots, not just player value.',
  ];
  if (note?.trim()) lines.push(`Also: ${note.trim()}`);
  return lines.join('\n');
}
