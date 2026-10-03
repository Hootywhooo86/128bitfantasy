import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, CardHead, Chips, Empty, Field, Label, Note, Screen } from '@/components/ui';
import { AiCoachError, getProviderMeta } from '@/lib/ai/ai-coach';
import { askCoachesCorner, webNote, type CornerReply } from '@/lib/ai/coaches-corner';
import { getAiSettings, type AiSettings } from '@/lib/ai/settings';
import { describeNetworkFailure } from '@/lib/net-errors';
import { colors, fonts } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { CORNER_MODES, type CornerMode } from '@/src/sports/coach-context';
import { cachedLeagues, cachedSnapshot, fetchSnapshot } from '@/src/sports/hub';
import type { League, ProviderId } from '@/src/sports/models';

const key = (l: Pick<League, 'provider' | 'id'>) => `${l.provider}:${l.id}`;

export default function CoachesCorner() {
  const params = useLocalSearchParams<{ provider?: ProviderId; id?: string }>();
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<CornerMode>('lineup');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<CornerReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const abort = useRef<AbortController | null>(null);

  useFocusEffect(
    useCallback(() => {
      getAiSettings().then(setAi);
      cachedLeagues().then((ls) => {
        setLeagues(ls);
        const fromParams = params.provider && params.id ? `${params.provider}:${params.id}` : null;
        setPicked((cur) => fromParams ?? cur ?? (ls[0] ? key(ls[0]) : null));
      });
    }, [params.provider, params.id])
  );

  const league = leagues?.find((l) => key(l) === picked) ?? null;

  async function ask() {
    if (!league) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      // Fresh rosters if we can get them; the last copy if not.
      const snap = await fetchSnapshot(league, ctl.signal).catch(async (e) => {
        const cached = await cachedSnapshot(league);
        if (!cached) throw e;
        return cached;
      });
      setReply(await askCoachesCorner(snap, mode, question, ctl.signal));
    } catch (e) {
      if (ctl.signal.aborted) return;
      setError(e instanceof AiCoachError ? e.message : describeNetworkFailure(e, 'the coach request'));
    } finally {
      setBusy(false);
    }
  }

  if (leagues && leagues.length === 0) {
    return (
      <Screen section="Coaches Corner">
        <Hero />
        <Empty
          title="NOTHING TO COACH YET"
          body="Connect a league and the coach will read your roster, check today's news, and make the call."
          action={{ label: 'CONNECT A LEAGUE', onPress: () => router.push('/leagues') }}
        />
      </Screen>
    );
  }

  return (
    <Screen section="Coaches Corner">
      <Hero />

      {ai && !ai.hasKey ? (
        <Card onPress={() => router.push('/settings')} style={{ borderColor: colors.warn }}>
          <Text style={st.warnT}>ADD AN AI KEY</Text>
          <Text style={st.warnB}>
            Coaches Corner uses your own AI key — Anthropic, OpenAI, Gemini, OpenRouter, Groq, Hugging Face or custom, the
            same choices as 128BIT FIT. Tap to set it up.
          </Text>
        </Card>
      ) : null}

      <Label>LEAGUE</Label>
      <View style={{ gap: 6 }}>
        {(leagues ?? []).map((l) => (
          <Pressable key={key(l)} onPress={() => setPicked(key(l))} style={[st.lg, key(l) === picked && st.lgOn]}>
            <Text style={[st.lgT, key(l) === picked && { color: colors.accent }]} numberOfLines={1}>{l.name}</Text>
            <Text style={st.lgS}>{`${l.sport.toUpperCase()} · ${providerLabel(l.provider)}`}</Text>
          </Pressable>
        ))}
      </View>

      <Label>CALL THE PLAY</Label>
      <Chips items={CORNER_MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={setMode} />
      <Text style={st.blurb}>{CORNER_MODES.find((m) => m.id === mode)?.blurb}</Text>
      <Field
        label={mode === 'ask' ? 'YOUR QUESTION' : 'ANYTHING ELSE? (OPTIONAL)'}
        value={question}
        onChangeText={setQuestion}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        placeholder={mode === 'ask' ? 'Should I trade my RB2 for their WR1?' : 'e.g. I can only start one of my two TEs'}
      />
      <Button label="BLOW THE WHISTLE" onPress={ask} busy={busy} disabled={!league || !ai?.hasKey} />
      {busy ? <Note>Checking injury reports, news and matchups online… this can take a minute.</Note> : null}

      {error ? <Note tone="error">{error}</Note> : null}

      {reply ? (
        <Card style={{ marginTop: 14, borderColor: colors.accent }}>
          <CardHead title="COACH SAYS" note={reply.model} />
          <Text style={st.reply} selectable>{reply.content}</Text>
          <Text style={st.web}>{webNote(reply.web)}</Text>
          {reply.web.status === 'on' && reply.web.sources.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {reply.web.sources.slice(0, 6).map((s) => (
                <Pressable key={s.url} onPress={() => WebBrowser.openBrowserAsync(s.url)}>
                  <Text style={st.src} numberOfLines={1}>↗ {s.title ?? s.url}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {ai?.hasKey ? (
        <Note>{`Using ${getProviderMeta(ai.provider).label} · ${ai.model}. Advice only — you make the moves.`}</Note>
      ) : null}
    </Screen>
  );
}

function Hero() {
  return (
    <View style={st.hero}>
      <Image source={require('@/assets/brand/logo.png')} style={st.heroImg} />
      <Text style={st.heroT}>COACHES CORNER</Text>
      <Text style={st.heroS}>The AI reads today&apos;s news, then makes the call.</Text>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 14 },
  heroImg: { width: 84, height: 84 },
  heroT: { fontFamily: fonts.pixel, fontSize: 15, color: colors.accent, letterSpacing: 1.5, marginTop: 10 },
  heroS: { fontSize: 13, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
  warnT: { fontFamily: fonts.pixel, fontSize: 9.5, color: colors.warn, letterSpacing: 1 },
  warnB: { fontSize: 12.5, color: colors.textMuted, marginTop: 7, lineHeight: 19, fontFamily: fonts.body },
  lg: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 12 },
  lgOn: { borderColor: colors.accent },
  lgT: { fontSize: 14.5, fontFamily: fonts.bodySemi, color: colors.text },
  lgS: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1, marginTop: 5 },
  blurb: { fontSize: 12.5, color: colors.textMuted, marginVertical: 10, fontFamily: fonts.body },
  reply: { fontSize: 14.5, color: colors.text, lineHeight: 22, fontFamily: fonts.body },
  web: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 0.8, marginTop: 14 },
  src: { fontSize: 12.5, color: colors.accent, marginTop: 6, fontFamily: fonts.body },
});
