import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chips, Field, Note, Screen } from '@/components/ui';
import { AiCoachError, getProviderMeta } from '@/lib/ai/ai-coach';
import { askCoach, clearThread, loadThread, sourcesOf, webNote, type ThreadMessage, type TradeDeal } from '@/lib/ai/coaches-corner';
import { getAiSettings, type AiSettings } from '@/lib/ai/settings';
import { describeNetworkFailure } from '@/lib/net-errors';
import { usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { CORNER_MODES, type CornerMode } from '@/src/sports/coach-context';
import { cachedLeagues, cachedSnapshot, fetchSnapshot } from '@/src/sports/hub';
import type { LeagueSnapshot, ProviderId, Roster } from '@/src/sports/models';
import { snapshotWithPrefs } from '@/src/sports/prefs';

/**
 * Coaches Corner for one team. The coach gets this team's league data —
 * refreshed on every question — and remembers the conversation per team.
 */
export default function TeamCoach() {
  const { provider, id, team, q } = useLocalSearchParams<{ provider: ProviderId; id: string; team: string; q?: string }>();
  const router = useRouter();
  const prefs = usePrefs();
  const [snap, setSnap] = useState<LeagueSnapshot | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  // Opened from a player: start on ASK with the question already written.
  const [mode, setMode] = useState<CornerMode>(q ? 'ask' : 'lineup');
  const [question, setQuestion] = useState(q ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [partnerPick, setPartnerPick] = useState<string | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);

  useEffect(() => {
    getAiSettings().then(setAi);
    cachedSnapshot({ provider, id }).then(async (s) => {
      if (!s) return;
      setSnap(s);
      setThread(await loadThread(s, team));
    });
    return () => abort.current?.abort();
  }, [provider, id, team]);

  const view = snap ? snapshotWithPrefs(snap, prefs) : null;
  const teamName = view?.teams.find((t) => t.id === team)?.name ?? 'this team';
  const scouting = !!view && view.league.myTeamId !== team;
  // TRADE CHECK: from my team the partner is picked; scouting, it's the team on screen.
  const mine = view?.league.myTeamId ?? null;
  const partnerId = scouting ? team : partnerPick;
  const myRoster = view?.rosters.find((r) => r.teamId === (scouting ? mine : team));
  const partnerRoster = partnerId ? view?.rosters.find((r) => r.teamId === partnerId) : undefined;
  const nameOf = (r: Roster | undefined, ids: string[]) => ids.map((i) => r?.players.find((p) => p.id === i)?.name ?? i);
  const deal: TradeDeal | undefined =
    mode === 'grade' && partnerId && (give.length || get.length)
      ? { partnerId, give: nameOf(myRoster, give), get: nameOf(partnerRoster, get) }
      : undefined;
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    set((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  async function ask() {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    try {
      // Fresh rosters if we can get them; the last copy if not.
      const league = (await cachedLeagues()).find((l) => l.provider === provider && l.id === id);
      let s = snap;
      if (league) s = await fetchSnapshot(league, ctl.signal).catch(() => snap);
      if (!s) throw new Error('No data for this league yet. Pull to refresh it first.');
      setSnap(s);
      setThread(await askCoach(snapshotWithPrefs(s, prefs), team, mode, question, ctl.signal, deal));
      setQuestion('');
    } catch (e) {
      if (ctl.signal.aborted) return;
      setError(e instanceof AiCoachError ? e.message : describeNetworkFailure(e, 'the coach request'));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!snap) return;
    await clearThread(snap, team);
    setThread([]);
  }

  return (
    <Screen section="Coaches Corner" back>
      <View style={st.hero}>
        <Image source={require('@/assets/brand/logo.png')} style={st.heroImg} />
        <Text style={st.heroT}>{scouting ? 'SCOUTING REPORT' : 'COACHES CORNER'}</Text>
        <Text style={st.heroS} numberOfLines={2}>
          {view ? `${teamName} · ${view.league.name} · ${providerLabel(view.league.provider)}` : 'Loading team…'}
        </Text>
      </View>

      {ai && !ai.hasKey ? (
        <Card onPress={() => router.push('/settings/ai')} style={{ borderColor: colors.warn }}>
          <Text style={st.warnT}>ADD AN AI KEY</Text>
          <Text style={st.warnB}>
            Coaches Corner uses your own AI key — Claude, OpenAI, Gemini, OpenRouter, Groq, Hugging Face or custom, the same
            choices as 128BIT FIT. Tap to set it up.
          </Text>
        </Card>
      ) : null}

      {thread.map((m, i) => (
        <Bubble key={`${m.at}-${i}`} m={m} />
      ))}

      <Chips items={CORNER_MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={setMode} />
      <Text style={st.blurb}>{CORNER_MODES.find((m) => m.id === mode)?.blurb}</Text>
      {mode === 'grade' && view ? (
        <Card>
          {!scouting ? (
            <>
              <Text style={st.pickT}>TRADE WITH</Text>
              <View style={st.pills}>
                {view.teams
                  .filter((t) => t.id !== team)
                  .map((t) => (
                    <Pill key={t.id} label={t.name} on={partnerPick === t.id} onPress={() => { setPartnerPick(t.id); setGet([]); }} />
                  ))}
              </View>
            </>
          ) : null}
          <Text style={st.pickT}>YOU GIVE</Text>
          <View style={st.pills}>
            {(myRoster?.players ?? []).map((p) => (
              <Pill key={p.id} label={`${p.name}${p.position ? ` ${p.position}` : ''}`} on={give.includes(p.id)} onPress={() => toggle(setGive, p.id)} />
            ))}
          </View>
          {partnerRoster ? (
            <>
              <Text style={st.pickT}>{`YOU GET FROM ${(view.teams.find((t) => t.id === partnerId)?.name ?? '').toUpperCase()}`}</Text>
              <View style={st.pills}>
                {partnerRoster.players.map((p) => (
                  <Pill key={p.id} label={`${p.name}${p.position ? ` ${p.position}` : ''}`} on={get.includes(p.id)} onPress={() => toggle(setGet, p.id)} />
                ))}
              </View>
            </>
          ) : null}
        </Card>
      ) : null}

      <Field
        label={mode === 'ask' ? 'YOUR QUESTION' : thread.length ? 'FOLLOW-UP (OPTIONAL)' : 'ANYTHING ELSE? (OPTIONAL)'}
        value={question}
        onChangeText={setQuestion}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        placeholder={mode === 'ask' ? 'Should I trade my RB2 for their WR1?' : 'e.g. I can only start one of my two TEs'}
      />
      <Button
        label={mode === 'grade' ? 'GRADE THIS TRADE' : 'BLOW THE WHISTLE'}
        onPress={ask}
        busy={busy}
        disabled={!snap || !ai?.hasKey || (mode === 'grade' && !deal)}
      />
      {busy ? <Note>Checking injury reports, news and matchups online… this can take a minute.</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      {thread.length ? <Button label="NEW CONVERSATION" kind="ghost" onPress={reset} /> : null}

      {ai?.hasKey ? (
        <Note>{`Using ${getProviderMeta(ai.provider).label} · ${ai.model}. The coach sees ${scouting ? 'this team and yours' : 'your team'}, its matchup and the standings — fresh each question. Advice only: you make the moves.`}</Note>
      ) : null}
    </Screen>
  );
}

function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[st.pill, on && st.pillOn]}>
      <Text style={[st.pillT, on && st.pillTOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Bubble({ m }: { m: ThreadMessage }) {
  if (m.role === 'user') {
    return (
      <View style={st.me}>
        <Text style={st.meT} numberOfLines={4}>{m.content}</Text>
      </View>
    );
  }
  const sources = sourcesOf(m);
  return (
    <Card style={{ borderColor: colors.accent }}>
      <Text style={st.coachL}>{`COACH · ${m.model ?? ''}`}</Text>
      <Text style={st.reply} selectable>{m.content}</Text>
      <Text style={st.web}>{webNote(m.web)}</Text>
      {sources.slice(0, 6).map((s) => (
        <Pressable key={s.url} onPress={() => WebBrowser.openBrowserAsync(s.url)}>
          <Text style={st.src} numberOfLines={1}>↗ {s.title ?? s.url}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    hero: { alignItems: 'center', paddingVertical: 10 },
    heroImg: { width: 76, height: 76 },
    heroT: { fontFamily: fonts.pixel, fontSize: 14, color: colors.accent, letterSpacing: 1.5, marginTop: 8 },
    heroS: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body, textAlign: 'center' },
    warnT: { fontFamily: fonts.pixel, fontSize: 9.5, color: colors.warn, letterSpacing: 1 },
    warnB: { fontSize: 12.5, color: colors.textMuted, marginTop: 7, lineHeight: 19, fontFamily: fonts.body },
    blurb: { fontSize: 12.5, color: colors.textMuted, marginVertical: 10, fontFamily: fonts.body },
    me: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 10, marginBottom: 8 },
    meT: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.body, lineHeight: 19 },
    coachL: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.accent, letterSpacing: 1, marginBottom: 8 },
    reply: { fontSize: 14.5, color: colors.text, lineHeight: 22, fontFamily: fonts.body },
    web: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 0.8, marginTop: 14 },
    src: { fontSize: 12.5, color: colors.accent, marginTop: 6, fontFamily: fonts.body },
    pickT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1.2, marginTop: 6, marginBottom: 8 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    pill: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 10, maxWidth: '100%' },
    pillOn: { borderColor: colors.accent, backgroundColor: colors.accent },
    pillT: { fontSize: 12.5, color: colors.textMuted, fontFamily: fonts.body },
    pillTOn: { color: colors.onAccent, fontFamily: fonts.bodySemi },
  })
);
