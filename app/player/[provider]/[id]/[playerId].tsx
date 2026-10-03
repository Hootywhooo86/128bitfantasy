import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Button, Card, CardHead, Empty, Label, Note, Screen } from '@/components/ui';
import { OddsCard } from '@/components/OddsCard';
import { playerNews, useInsights } from '@/lib/insights';
import { useOddsEnabled } from '@/lib/odds';
import { describeNetworkFailure } from '@/lib/net-errors';
import { usePrefs } from '@/lib/storage/prefs';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { providerLabel } from '@/src/providers/http';
import { newsAge, type NewsItem } from '@/src/sports/insights';
import { cachedSnapshot } from '@/src/sports/hub';
import type { LeagueSnapshot, ProviderId } from '@/src/sports/models';
import { snapshotWithPrefs } from '@/src/sports/prefs';

/**
 * One player: the injury and practice status, this week's projection, and the
 * latest news — the stories behind the scroll icon. Ask the coach from here
 * and the question arrives already about him.
 */
export default function PlayerScreen() {
  const { provider, id, playerId, team } = useLocalSearchParams<{ provider: ProviderId; id: string; playerId: string; team?: string }>();
  const router = useRouter();
  const prefs = usePrefs();
  const oddsOn = useOddsEnabled();
  const [raw, setRaw] = useState<LeagueSnapshot | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);

  useEffect(() => {
    cachedSnapshot({ provider, id }).then(setRaw);
  }, [provider, id]);

  const snap = raw ? snapshotWithPrefs(raw, prefs) : null;
  const owner = raw?.rosters.find((r) => r.players.some((p) => p.id === playerId));
  const player = owner?.players.find((p) => p.id === playerId);
  // Insights for just this player, so nothing else is loaded for this screen.
  const one = useMemo(() => (owner && player ? { ...owner, players: [player] } : undefined), [owner, player]);
  const insight = useInsights(raw, one)[playerId];
  const espnId = insight?.espnId ?? null;
  const sport = raw?.league.sport;

  useEffect(() => {
    if (!espnId || !sport) return;
    let live = true;
    playerNews(sport, espnId)
      .then((n) => live && setNews(n))
      .catch((e) => live && setNewsError(describeNetworkFailure(e, 'the news request')));
    return () => {
      live = false;
    };
  }, [espnId, sport]);

  if (!snap || !player) {
    return (
      <Screen section="Player" back>
        <Empty title="LOADING" body="Reading the roster…" />
      </Screen>
    );
  }

  const ownerTeam = snap.teams.find((t) => t.id === owner?.teamId);
  const coachTeam = team ?? owner?.teamId ?? snap.league.myTeamId;
  const tagColor = insight?.level === 'questionable' ? colors.warn : insight?.level === 'doubtful' ? '#ff9a3d' : colors.loss;

  return (
    <Screen section={`${snap.league.sport.toUpperCase()} · ${providerLabel(snap.league.provider)}`} back>
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <Text style={st.name}>{player.name}</Text>
          <Text style={st.meta}>
            {[player.position, player.proTeam, player.lineupSlot ? `slot ${player.lineupSlot}` : null, ownerTeam?.name].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        {insight?.hasNews ? <Image source={require('@/assets/brand/scroll.png')} style={st.bigScroll} /> : null}
      </View>

      <View style={st.tiles}>
        <View style={st.tile}>
          <Text style={st.tileV}>{insight?.projection != null ? insight.projection.toFixed(1) : '—'}</Text>
          <Text style={st.tileL}>{insight?.projectionSource ? `PROJ · ${insight.projectionSource.toUpperCase()}` : 'PROJECTED'}</Text>
        </View>
        <View style={st.tile}>
          <Text style={[st.tileV, insight?.tag ? { color: tagColor } : null]}>{insight?.tag ?? 'OK'}</Text>
          <Text style={st.tileL}>STATUS</Text>
        </View>
      </View>
      {insight?.projection == null ? (
        <Note>
          {snap.league.sport === 'nfl'
            ? 'No projection for him this week.'
            : 'Projections for this sport only come with ESPN leagues — no guesses here.'}
        </Note>
      ) : null}
      {insight?.detail ? (
        <Card>
          <CardHead title="INJURY" />
          <Text style={st.body}>{insight.detail}</Text>
        </Card>
      ) : null}

      {oddsOn ? (
        <OddsCard player={player} sport={snap.league.sport} espnId={espnId} />
      ) : (
        <Text style={st.oddsOff} onPress={() => router.push('/settings')}>
          Betting odds are off — turn them on in Settings (21+).
        </Text>
      )}

      <Label>LATEST NEWS</Label>
      {!espnId ? (
        <Note>We couldn&apos;t match him to a news feed (another player shares his name, or he&apos;s not in ESPN&apos;s list).</Note>
      ) : newsError ? (
        <Note tone="error">{newsError}</Note>
      ) : news === null ? (
        <Note>Loading news…</Note>
      ) : news.length === 0 ? (
        <Note>No recent news.</Note>
      ) : (
        news.slice(0, 6).map((n) => (
          <Card key={n.id}>
            <View style={st.newsHead}>
              <Image source={require('@/assets/brand/scroll.png')} style={st.smScroll} />
              <Text style={st.newsAge}>{`${newsAge(n.published).toUpperCase()}${n.source ? ` · ${n.source.toUpperCase()}` : ''}`}</Text>
            </View>
            <Text style={st.headline}>{n.headline}</Text>
            {n.story ? <Text style={st.story}>{n.story}</Text> : null}
          </Card>
        ))
      )}

      {coachTeam ? (
        <Button
          label="ASK COACH ABOUT HIM"
          onPress={() =>
            router.push({
              pathname: '/coach/[provider]/[id]/[team]',
              params: { provider, id, team: coachTeam, q: `What should I do with ${player.name} this week?` },
            })
          }
        />
      ) : null}
    </Screen>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    name: { fontSize: 24, fontFamily: fonts.bodyBold, color: colors.text },
    meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontFamily: fonts.body },
    bigScroll: { width: 40, height: 40 },
    tiles: { flexDirection: 'row', gap: 8, marginVertical: 14 },
    tile: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingVertical: 13, alignItems: 'center' },
    tileV: { fontSize: 24, fontFamily: fonts.bodyBold, color: colors.text },
    tileL: { fontFamily: fonts.pixel, fontSize: 7, color: colors.textDim, letterSpacing: 1, marginTop: 6 },
    body: { fontSize: 14, color: colors.text, fontFamily: fonts.body, lineHeight: 20 },
    newsHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
    smScroll: { width: 14, height: 14 },
    newsAge: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 0.8 },
    headline: { fontSize: 14.5, color: colors.text, fontFamily: fonts.bodySemi, lineHeight: 21 },
    story: { fontSize: 13.5, color: colors.textMuted, fontFamily: fonts.body, lineHeight: 20, marginTop: 8 },
    oddsOff: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginBottom: 6, textDecorationLine: 'underline' },
  })
);
