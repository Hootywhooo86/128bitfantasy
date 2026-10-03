# 128BIT FANTASY

<img src="assets/brand/logo.png" width="96" alt="Silver pixel whistle logo" />

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
npm run test:live        # hits the real APIs
```

## What's in it

| Screen | What it does |
|---|---|
| **Home · My Teams** | Only teams you're in and chose to show, filtered by sport (ALL / NFL / NBA / MLB / NHL). Record, rank, live score, how fresh it is. Opens instantly from cache, then catches up. |
| **Team** | Your matchup, roster by slot with injury tags, standings. Tap any team in the standings (or your opponent) to scout it. |
| **Coaches Corner** | Per team. Opened from a team, the coach gets that team's roster, matchup and league — refreshed every question — and remembers the conversation. Scouting another team? It sees theirs and yours, for trade ideas. |
| **Settings** | Everything else, see below. |

Settings holds:
- **Sign in** — every provider, with a card saying how to sign in, **what its API can do (read & write / read only)**, that **this app is read only** everywhere, help links for when it goes wrong, and that provider's live API status.
- **My Teams** — show/hide each league; pick your team where the provider couldn't say (e.g. ESPN without SWID).
- **Colors** — 11 presets (silver default) or any hex. Win/loss/injury colours stay fixed.
- **Coaches Corner AI** — provider, model, key.
- **Updates** — SYNC ALL NOW, CHECK FANTASY APIS, CHECK FOR APP UPDATE (GitHub Releases, built by the `APK` workflow).

Read-only everywhere. The app never changes a lineup or makes a move, even where a provider's API could.

## Watching for API changes

Providers change their APIs without notice. Three layers catch it:

1. **In the app, daily** — `src/providers/health.ts` probes each provider (one cheap public request + a check of the fields we parse). Runs on launch at most once a day and from Settings. A "changed" result puts a banner on Home.
2. **On every load** — `snapshotProblems()` flags data that came back but reads empty (no teams, empty rosters, missing names) and says the API may have changed instead of showing blanks.
3. **In CI, daily** — `.github/workflows/api-watch.yml` runs `npm run test:live` (`contract/apis.live.ts`) against the real APIs and goes red when a shape changes.

On the web build, browsers block cross-site reads from Yahoo, Fantrax and Fleaflicker (no CORS), so the in-app check is phone-only there.

## Speed

- Cache-first everywhere: screens paint from the last snapshot, then refresh in the background (3 at a time, only if older than 5 min).
- Parsed JSON is held in memory after first read — the player catalog is parsed once per launch, not per screen.
- Duplicate requests for the same league share one fetch.
- One automatic retry on dropped connections / gateway errors.
- Team cards are memoised, so one league refreshing re-renders one card.

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
  index.tsx               Home — my teams by sport
  league/[provider]/[id]  team view (any team in the league)
  coach/[provider]/[id]/[team]  Coaches Corner for one team
  settings/index.tsx      sign-ins, my teams, colors, AI, updates
  settings/account/[provider]  sign in + help + read/write + API status
  settings/teams.tsx      show/hide leagues, pick your team
  settings/ai.tsx         AI provider / model / key
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
  sports/prefs.ts         which leagues show, which team is yours
  providers/info.ts       help links, read/write, sign-in steps
  providers/health.ts     the API watch
contract/                 live API contract tests (daily in CI)
scripts/build-logo.mjs    draws the pixel whistle → every icon size
```

Rules:
- **Providers fetch. Sports normalize.** Each adapter turns its provider's JSON into
  `src/sports/models.ts` shapes; nothing provider-shaped reaches a screen.
- **Absent is not zero.** No points yet → `—`, not `0`. Unknown injury → no tag, not "healthy".
- **One provider failing never blanks the others.** It keeps its last synced leagues and shows one line of error.
- **Never commit credentials.** Tokens, cookies and keys live in the keystore.

## Logo

A silver pixel whistle, tilted mid-blow, on a 28×28 grid — drawn in code by
rotating the shape (not the pixels) so the edges stay clean. `npm run build:logo`
regenerates `assets/brand/*` and `assets/images/*`.

## Next

- `src/events.ts`: emit 128bit feed events (`matchup.won`, `waiver.claimed`, lineup-set streaks) so 128bitlife can turn them into quests + XP.
- MyFantasyLeague provider.
- Share the AI client with 128BIT FIT as a package instead of a copy.
