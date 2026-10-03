import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardHead, Note } from '@/components/ui';
import { espnIndex } from '@/lib/insights';
import { describeNetworkFailure } from '@/lib/net-errors';
import { gameProps, RESPONSIBLE_GAMING, slateOdds } from '@/lib/odds';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { americanOdds, gameForAbbr, gameForTeam, hasOdds, payoutOn10, type GameOdds, type PlayerProps, type Price } from '@/src/betting/odds';
import type { RosterPlayer, Sport } from '@/src/sports/models';

/**
 * Odds for one player: his team's game (spread, total, moneyline — tap one to
 * open that bet in the sportsbook) and his own lines. Read-only; the bet is
 * placed in the sportsbook's app, under its own checks.
 */
export function OddsCard({ player, sport, espnId }: { player: RosterPlayer; sport: Sport; espnId: string | null }) {
  const [game, setGame] = useState<GameOdds | null | undefined>(undefined);
  const [props, setProps] = useState<PlayerProps | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const games = await slateOdds(sport);
        // His ESPN team first (exact), the roster's team abbreviation second.
        const idx = espnId ? await espnIndex(sport).catch(() => null) : null;
        const teamId = espnId && idx?.byId.get(espnId)?.proTeamId;
        const g = gameForTeam(games, teamId != null ? String(teamId) : null) ?? gameForAbbr(games, player.proTeam, sport);
        if (!live) return;
        setGame(g);
        if (g && espnId && hasOdds(g)) {
          const byPlayer = await gameProps(sport, g.eventId).catch(() => null);
          if (live) setProps(byPlayer?.get(espnId) ?? null);
        }
      } catch (e) {
        if (live) setError(describeNetworkFailure(e, 'the odds request'));
      }
    })();
    return () => {
      live = false;
    };
  }, [sport, espnId, player.proTeam]);

  const open = (url: string | null) => url && Linking.openURL(url).catch(() => undefined);

  return (
    <Card>
      <CardHead title="ODDS" note={game?.book ? `via ${game.book}` : undefined} />
      {error ? <Note tone="error">{error}</Note> : null}
      {game === undefined && !error ? <Text style={st.muted}>Loading odds…</Text> : null}
      {game === null ? <Text style={st.muted}>No game for his team on this week’s board.</Text> : null}
      {game && !hasOdds(game) ? (
        <Text style={st.muted}>{`${game.away.abbr} @ ${game.home.abbr} — no lines posted${game.status === 'STATUS_FINAL' ? ' (game over)' : ' yet'}.`}</Text>
      ) : null}

      {game && hasOdds(game) ? (
        <>
          <Text style={st.game}>{`${game.away.abbr} @ ${game.home.abbr}`}</Text>
          <Text style={st.muted}>{`${new Date(game.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${game.details ? ` · ${game.details}` : ''}`}</Text>
          <View style={st.table}>
            <Row label="SPREAD" a={game.spread?.away} h={game.spread?.home} onOpen={open} />
            <Row label="TOTAL" a={game.total?.over} h={game.total?.under} onOpen={open} />
            <Row label="MONEYLINE" a={game.moneyline?.away} h={game.moneyline?.home} onOpen={open} />
          </View>
          <Text style={st.hint}>{`Columns: ${game.away.abbr} / over · ${game.home.abbr} / under. Tap a price to open that bet. $10 shows what a win pays back.`}</Text>
        </>
      ) : null}

      {props && (props.lines.length || props.scorer.length) ? (
        <>
          <Text style={st.sub}>{`${player.name.toUpperCase()} LINES`}</Text>
          {props.lines.slice(0, 8).map((l) => (
            <View key={l.market} style={st.lineRow}>
              <Text style={st.market}>{l.market}</Text>
              <Text style={st.lineV}>{`O/U ${l.line}`}</Text>
              {l.openLine != null && l.openLine !== l.line ? (
                <Text style={[st.move, { color: (l.line ?? 0) > l.openLine ? colors.win : colors.loss }]}>{`opened ${l.openLine}`}</Text>
              ) : null}
            </View>
          ))}
          {props.scorer.length ? <Text style={st.muted}>{`Also offered: ${props.scorer.join(', ')}`}</Text> : null}
          <Text style={st.hint}>Player prices aren’t in the free feed — they show in the sportsbook.</Text>
        </>
      ) : game && hasOdds(game) ? (
        <Text style={st.hint}>No player lines posted for him yet.</Text>
      ) : null}

      {game?.eventUrl ? (
        <Pressable style={({ pressed }) => [st.btn, pressed && { opacity: 0.8 }]} onPress={() => open(game.eventUrl)}>
          <Text style={st.btnT}>{`BET THIS GAME IN ${game.book.toUpperCase()} ↗`}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => open(RESPONSIBLE_GAMING.url)}>
        <Text style={st.rg}>{RESPONSIBLE_GAMING.line}</Text>
      </Pressable>
    </Card>
  );
}

function Cell({ p, onOpen }: { p: Price | undefined; onOpen: (u: string | null) => void }) {
  if (!p || (!p.odds && !p.line)) return <Text style={[st.cell, st.muted]}>—</Text>;
  const pay = payoutOn10(p.odds);
  return (
    <Pressable style={({ pressed }) => [st.cellBox, pressed && { backgroundColor: colors.surfaceAlt }]} onPress={() => onOpen(p.link)} disabled={!p.link}>
      <Text style={st.cell}>{[p.line, americanOdds(p.odds)].filter(Boolean).join('  ')}</Text>
      {pay != null ? <Text style={st.pay}>{`$10 → $${pay.toFixed(2)}`}</Text> : null}
    </Pressable>
  );
}

function Row({ label, a, h, onOpen }: { label: string; a?: Price; h?: Price; onOpen: (u: string | null) => void }) {
  return (
    <View style={st.row}>
      <Text style={st.rowL}>{label}</Text>
      <Cell p={a} onOpen={onOpen} />
      <Cell p={h} onOpen={onOpen} />
    </View>
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    muted: { fontSize: 12.5, color: colors.textMuted, fontFamily: fonts.body, marginTop: 4 },
    game: { fontSize: 18, fontFamily: fonts.bodyBold, color: colors.text },
    table: { marginTop: 10, gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowL: { width: 74, fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 0.8 },
    cellBox: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 7, alignItems: 'center' },
    cell: { flex: 1, textAlign: 'center', fontSize: 13.5, fontFamily: fonts.bodySemi, color: colors.text },
    pay: { fontSize: 10.5, color: colors.textDim, fontFamily: fonts.body, marginTop: 2 },
    hint: { fontSize: 11.5, color: colors.textDim, fontFamily: fonts.body, marginTop: 8, lineHeight: 16 },
    sub: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1.2, marginTop: 16, marginBottom: 6 },
    lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
    market: { flex: 1, fontSize: 13.5, color: colors.text, fontFamily: fonts.body },
    lineV: { fontSize: 13.5, color: colors.text, fontFamily: fonts.bodySemi },
    move: { fontSize: 11, fontFamily: fonts.body },
    btn: { marginTop: 14, backgroundColor: colors.accent, borderRadius: 9, paddingVertical: 12, alignItems: 'center' },
    btnT: { fontFamily: fonts.pixel, fontSize: 9, color: colors.onAccent, letterSpacing: 1 },
    rg: { fontSize: 11, color: colors.textDim, fontFamily: fonts.body, marginTop: 10, textAlign: 'center', textDecorationLine: 'underline' },
  })
);
