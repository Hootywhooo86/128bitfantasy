# 128bit Fantasy

All your fantasy teams — Sleeper, Yahoo, Fantrax — in one gamified hub.
Separated by sport. Part of the 128bit family.

## Provider API status (researched 2026-10-03)

| Provider | API | Auth | Difficulty |
|---|---|---|---|
| **Sleeper** | ✅ Official public REST (`https://api.sleeper.app/v1`) | None — read-only, no token | Easy. ~1000 calls/min. Docs: `https://docs.sleeper.com` |
| **Yahoo** | ✅ Official Fantasy Sports API | OAuth 1.0a (3-legged), app registration at `developer.yahoo.com` | Medium-hard. Auth is the painful part; read+write once connected |
| **Fantrax** | ❌ No official public API | Session cookie via login (unofficial) | Hard. Community libs hit undocumented internal endpoints (`/fxpa/req`); version strings rotate (`STALE_CLIENT`), writes need a headless-browser session. Isolate this provider — it will break and need repairs |

Key Sleeper endpoints: `GET /user/{username}`, `/user/{id}/leagues/nfl/{season}`,
`/league/{id}/rosters`, `/league/{id}/matchups/{week}`, `/league/{id}/transactions/{week}`,
`/players/nfl` (cache daily — it's ~14MB), `/state/nfl`.

## Architecture — separated by sport

```
src/
  providers/
    sleeper/    # REST client, no auth. Start here.
    yahoo/      # OAuth 1.0a client + token refresh.
    fantrax/    # Unofficial client. Quarantined: expect breakage.
  sports/
    nfl/        # Normalized Team, Matchup, Player models + cross-provider aggregation
    nhl/
    mlb/        # add as leagues demand
  events.ts     # 128bit shared event schema — emit matchup.won, waiver.claimed, etc.
                # 128bitlife subscribes to the feed for quests + XP.
```

Rules:
- **Providers fetch. Sports normalize.** No provider-specific shapes leak past `sports/`.
- One sport = one aggregated view across all providers (e.g. NHL tab shows Yahoo + Fantrax teams side by side).
- Never store raw credentials in the repo. OAuth tokens / session cookies live in env or secure storage.

## Start-here brief for Claude

```
We're building 128bit Fantasy — aggregate fantasy sports hub (Sleeper, Yahoo, Fantrax),
separated by sport. Read this README first.

Build order:
1. src/providers/sleeper/ — REST client (no auth). Functions: getUser, getLeagues,
   getRosters, getMatchups(week), getTransactions(week). Cache the player catalog.
2. src/sports/nfl/ — normalized models (Team, Matchup, Transaction) + an
   aggregator that merges every connected provider into one view.
3. UI: pick the stack (Expo to match the 128bit family, or web-first — ask Daniel).
   Tabs by sport: NFL, NHL. Each sport shows every team across providers.
4. src/providers/yahoo/ — OAuth 1.0a flow + token refresh, then league/roster reads.
5. src/providers/fantrax/ — LAST. Unofficial endpoints, session auth, fragile.
   Research current community approaches before writing a line.

Constraints: providers fetch, sports normalize. Emit 128bit events (see events.ts
once created) for matchup wins, waiver claims, trades. Small commits, one
provider per commit. Never commit credentials.
```

## 128bit tie-in

Fantasy is a first-class 128bit citizen: `matchup.won`, lineup set streaks, and
waiver wins become events in the shared feed, so 128bitlife can issue quests
("set your Yahoo lineup") and XP. Don't silo the data.
