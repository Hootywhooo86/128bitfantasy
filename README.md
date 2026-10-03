# 128BIT FANTASY

<img src="assets/brand/logo.png" width="96" alt="Pixel whistle logo" />

Fantasy sports checker in the 128bit family. Every team you run — Sleeper, Yahoo,
ESPN, Fantrax, Fleaflicker — in one place, sorted by sport. Hit **Coaches Corner**
and an AI reads today's injury reports, news and matchups online, then tells you
who to start, who to pick up, and where to trade.

Expo / React Native, same stack, look and AI setup as 128BIT FIT.

## Run it

```bash
npm install
npx expo start          # device / simulator
npm run build:web && npm run serve:web   # web build at :8090
npm run typecheck && npm run lint && npm test
```

## What's in it

| Tab | What it does |
|---|---|
| **HOME** | Every connected league, filtered by sport chips (ALL / NFL / NBA / MLB / NHL). Your record, rank and live score per league. Pull to sync. |
| **LEAGUES** | Connect / disconnect each provider. |
| **COACH** | Coaches Corner: pick a league, pick a play — START/SIT, WAIVER WIRE, TRADE TALK, ASK COACH — and blow the whistle. |

Tap a league for your matchup, your roster by slot (starters / bench / IR / taxi)
with injury tags, and the standings — plus a Coaches Corner button for that league.

Read-only everywhere. The app never changes a lineup or makes a move.

## Providers (researched 2026-10-03)

| Provider | API | Connect with | Notes |
|---|---|---|---|
| **Sleeper** | Official public REST | Username | NFL + NBA. No auth. Player catalog (~14 MB) cached a day, trimmed to 4 fields. |
| **Yahoo** | Official Fantasy Sports v2, OAuth 2.0 | Your own Yahoo app's Client ID/Secret, then sign in | NFL/NBA/MLB/NHL. Token exchange needs a client secret, so it's bring-your-own like the AI key (redirect URI `oob`). Tokens auto-refresh. |
| **ESPN** | Unofficial v3 JSON (`lm-api-reads.fantasy.espn.com`) | League ID (+ `espn_s2` / `SWID` cookies for private leagues) | All four sports. No "my leagues" list without ESPN's fan API, so leagues are added by ID. SWID identifies your team. |
| **Fantrax** | Unofficial read-only `fxea/general` feed | League ID and/or User Secret ID | **Experimental.** Publicly viewable leagues only, no live scores. Shapes taken from the go-fantrax client; parsed defensively. |
| **Fleaflicker** | Official public API | Email | All four sports. No auth. |

Looked at and skipped for now: **CBS** (partner-only API), **NFL Fantasy**
(no public API), **MyFantasyLeague** (official API, easy add-on next).

## Coaches Corner (AI)

Same bring-your-own-key client as 128BIT FIT — `lib/ai/ai-coach.ts` is FIT's
`lib/ai-coach.ts` with a fantasy system prompt:

- **Anthropic**, **OpenAI**, **Google Gemini**, **OpenRouter**, **Groq**, **Hugging Face**, **Custom** (any OpenAI-compatible https endpoint)
- Key in the device keystore, sent only to the chosen provider.
- **Web search is always requested** (Anthropic / Gemini / OpenAI / OpenRouter / Groq GPT-OSS).
  The answer shows which sources it read. If the AI can't search, it still answers
  and says plainly the call is from roster data alone.
- The model gets the league's real context — scoring, week, your roster by slot,
  opponent's roster, injury tags, standings — built in `src/sports/coach-context.ts`.
  Missing data is left out, never filled in. No betting advice.

## Layout

```
app/                      Expo Router screens
  (tabs)/index.tsx        HOME — leagues by sport
  (tabs)/leagues.tsx      LEAGUES — providers
  (tabs)/corner.tsx       COACH — Coaches Corner
  league/[provider]/[id]  league detail
  connect/[provider]      connect forms
  settings.tsx            AI provider / model / key
components/               TopBar, ui kit, CoachesCornerButton (FIT's shell classes)
lib/
  ai/                     ai-coach (shared with FIT), coaches-corner, settings
  storage/                kv (expo-sqlite), secure (keystore), connections, player-cache
  net.ts, net-errors.ts, api-key.ts   shared with FIT
src/
  providers/<name>/       fetch + normalize one provider
  providers/registry.ts   wires adapters to caches
  sports/models.ts        League, Team, Roster, Matchup — what screens read
  sports/hub.ts           sync all providers, cache, group by sport
  sports/coach-context.ts the text Coaches Corner sends
scripts/build-logo.mjs    draws the pixel whistle → every icon size
```

Rules:
- **Providers fetch. Sports normalize.** Each adapter turns its provider's JSON into
  `src/sports/models.ts` shapes; nothing provider-shaped reaches a screen.
- **Absent is not zero.** No points yet → `—`, not `0`. Unknown injury → no tag, not "healthy".
- **One provider failing never blanks the others.** It keeps its last synced leagues and shows one line of error.
- **Never commit credentials.** Tokens, cookies and keys live in the keystore.

## Logo

A 24×24 pixel whistle in 128BIT FIT's teal/navy palette, drawn in code:
`npm run build:logo` regenerates `assets/brand/*` and `assets/images/*`.

## Next

- `src/events.ts`: emit 128bit feed events (`matchup.won`, `waiver.claimed`, lineup-set streaks) so 128bitlife can turn them into quests + XP.
- MyFantasyLeague provider.
- Share the AI client with 128BIT FIT as a package instead of a copy.
