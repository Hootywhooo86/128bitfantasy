# 128BIT LEAGUES: setup

128BIT LEAGUES runs your own hockey or football league inside 128BIT FANTASY. You get a draft, lineups, free agents and live scoring. The league lives in a free Supabase project that the commissioner owns. This app has no server of its own, there are no fees, and nobody else can see the data.

## Commissioner: once

1. **Create the project.**
   - Go to [supabase.com/dashboard](https://supabase.com/dashboard/projects) and click **New project**.
   - The free plan is enough. Pick any name, password and region.
2. **Add the league tables.**
   - Open **SQL Editor → New query**.
   - Paste all of [`schema.sql`](./schema.sql) and click **Run**.
   - It is safe to run again later. That is how you upgrade when this file changes.
3. **Turn on quick sign-in.**
   - Go to **Authentication → Sign In / Providers**.
   - Turn on **Allow anonymous sign-ins**.
   - This lets friends join with no email.
4. **Optional: email codes.** These let people keep their team when they change phones.
   - Go to **Authentication → Emails → Magic Link**.
   - Add `{{ .Token }}` to the email body so it shows a 6-digit code.
   - Supabase's built-in email sends only a few messages an hour. If you need more, set up your own SMTP under **Authentication → Emails → SMTP Settings**.
5. **Copy the connection details.**
   - Go to **Project Settings → API Keys**.
   - Copy the **Project URL** and the **publishable** key (older projects call it **anon**).
   - Never share the **secret** / **service_role** key.

## Everyone in the league

1. In the app, open **Settings → 128BIT LEAGUES**.
2. Paste the Project URL and publishable key, then tap **CONNECT**.
3. Sign in with **QUICK SIGN-IN** or an email code.
4. **Commissioner:** create the league, then use **SHARE INVITE** to send the 6-letter code. Send the URL and key with it the first time.
5. **Friends:** use **JOIN**, enter the code, and name your team.
6. **Commissioner:** tap **START THE DRAFT** once everyone has joined.

## How it works

- **Who can see what.** Row-level security limits each person to the leagues they are in.
- **How changes are checked.** Every change goes through a database function that checks it is allowed: your turn, your team, or the commissioner. The publishable key is safe to share for this reason.
- **Where scores come from.** Points are never typed in. They are computed on each phone from:
  - Hockey: the NHL's public stats (`api-web.nhle.com`, `api.nhle.com/stats`).
  - Baseball: MLB's public Stats API (`statsapi.mlb.com`).
  - Football: Sleeper's public weekly stats.
  - Basketball: Sleeper's public per-game stats, with tip-off times from ESPN's scoreboard.

  Football scoring uses Sleeper's own PPR table, so a week scores the same as it would on Sleeper.
- **When a player counts.** Every lineup move is logged with the server's clock. A game counts for a player only if he was in a starting slot when the game began. Moving someone in late does nothing for that game, so the app doesn't need to enforce locks.
- **How standings are stored.** A finished week's totals are recorded by the first phone that works them out. Standings are built from those totals.
- **Draft timing.** If someone runs out the clock, anyone in the league can auto-pick for them. The server checks that the time is really up.
- **Waivers.** A dropped player sits on waivers for the league's waiver days. Claims are private. When his time is up, whoever opens the league next settles it:
  - FAAB: highest bid wins, ties to waiver order.
  - Rolling: best waiver order wins, and that team goes to the back.
- **Trades.** Offers are accepted or declined by the other team. Then, depending on the league:
  - Instant: it goes through.
  - Commissioner: the commissioner can approve or veto during the review window, and it goes through when the window ends.
  - League vote: enough veto votes from other teams kill it.

  If a player has moved or a roster would overflow, the trade fails instead.
- **Settings.** The commissioner can change anything before the draft. After it, format, lineup, bench, categories, weeks and draft type lock. Scoring, IR, playoffs, waivers and trades can still change.
- **Draft picks** are tradeable: this season's until they're used, and next season's any time. The draft clock follows the new owner.
- **Auction drafts.** Teams take turns nominating, and everyone bids. Each bid restarts the clock. A team's maximum bid always keeps $1 for every other spot it still has to fill. Once the clock runs out, any phone in the league can close the sale.
- **New seasons.** The commissioner starts next season from the old one: same teams, owners, divisions and settings, plus any picks traded for that season. Everyone picks keepers from their final roster, and the commissioner starts the draft, which is shorter by the keeper count (dynasty leagues set their own number of rounds).
- **Commissioner tools.** The commissioner can move or release any player, set any lineup, rename teams and put them in divisions, fix waiver order and budgets, pick for the team on the clock, remove a team before the draft, or hand the league to someone else. All of it shows in league activity.
- **Upgrading.** Re-running `schema.sql` on an existing project adds the new tables and keeps every league.

## Tests

`supabase/test/flow.sql` plays a whole league through the draft as three users. `supabase/test/moves.sql` covers the rest: lineups, IR, both waiver types, the add limit, all three trade-review modes, the deadline and settings locks. `supabase/test/extras.sql` covers picks, auctions, keepers, new seasons, commissioner tools and positions for all four sports. All three run in CI against Postgres 16 on every pull request, on a fresh database.
