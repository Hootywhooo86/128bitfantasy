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
  - Football: Sleeper's public weekly stats.

  Football scoring uses Sleeper's own PPR table, so a week scores the same as it would on Sleeper.
- **When a player counts.** Every lineup move is logged with the server's clock. A game counts for a player only if he was in a starting slot when the game began. Moving someone in late does nothing for that game, so the app doesn't need to enforce locks.
- **How standings are stored.** A finished week's totals are recorded by the first phone that works them out. Standings are built from those totals.
- **Draft timing.** If someone runs out the clock, anyone in the league can auto-pick for them. The server checks that the time is really up.

## Tests

`supabase/test/flow.sql` plays a whole league through every function as three users. It runs in CI against Postgres 16 on every pull request.
