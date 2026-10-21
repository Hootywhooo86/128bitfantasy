# Changelog

## Sign in with your 128bit account

- **128BIT LEAGUES** signs in with the same email and password as the other 128bit apps. No email to wait for.
- Emailed sign-in links open the app instead of a dead `localhost:3000` page (set Supabase's Site URL to `bitfantasy://auth`).
- The code box also takes a pasted sign-in link, or the address of the page a link opened.
- `supabase/schema.sql` pins its helper functions' search path and keeps membership checks from signed-out callers.

## Bench alerts — every sport, every provider

- **"Bench: Zach Hyman plays 7:00 PM"** — a notification when a bench player's team plays today (this week in football) while a spot they fit sits idle: empty, held by a starter with no game or on a bye, or held by someone ruled out. Several at once arrive as one notification per league; each player alerts once per game.
- The same suggestions show in **LINEUP CHECK** on your team screen; with ESPN READ & WRITE on, START puts them in.
- ESPN hockey, basketball and baseball rosters now show each player's team and game time (they only did for football).
- Team codes from every provider match the scoreboard (LAK/LA, GSW/GS, CWS/CHW…), so game times show for more players.

Turn on Settings → GAME-DAY ALERTS to get them with the app closed.

## 128BIT LEAGUES — four sports, every league type

Host your own league in the app, in a free Supabase project you own (setup: `supabase/README.md`).

- **Sports:** hockey (NHL stats), football (Sleeper, scores match Sleeper PPR), basketball (Sleeper per-game stats + ESPN tip-offs), baseball (MLB Stats API).
- **Formats:** head-to-head points, head-to-head categories, most categories, total points, rotisserie; playoffs with byes; divisions (winners seeded first).
- **Rosters:** every position slot, flex spots, bench, IR, multi-position players; 2–20 teams.
- **Drafts:** snake, same order every round, or auction (budgets, bid clock); pick clock, auto-pick; tradeable draft picks.
- **Seasons:** keepers or dynasty; start next season with teams, divisions and traded picks carried over.
- **Moves:** waivers (rolling or FAAB), free agents, weekly add limit, trades of players and picks (instant, commissioner review or league vote, deadline).
- **Commissioner tools:** move/release any player, set any lineup, edit teams, divisions and budgets, pick for the team on the clock, hand over the league.

Already set up Supabase? Run the new `supabase/schema.sql` once — it upgrades in place and keeps your leagues.
