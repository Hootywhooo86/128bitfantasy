# 128BIT FANTASY — Privacy Policy

_Last updated: October 6, 2026_

128BIT FANTASY ("the app") shows your fantasy sports teams and lets you run your own leagues ("128BIT LEAGUES"). This policy explains what the app collects and where it goes.

## What stays on your phone

These are stored only on your device. The app's developer never receives them.

- **Fantasy site sign-ins:**
  - Sleeper username.
  - Yahoo sign-in tokens.
  - ESPN login cookies.
  - MyFantasyLeague, Fantrax and Fleaflicker IDs.

  Secrets go in the phone's secure storage (keystore). They are sent only to the site they belong to (Sleeper, Yahoo, ESPN and so on), to read your leagues. If you turn on ESPN READ & WRITE, they are also used to make the lineup changes you tap.
- **AI key for Coaches Corner.** It is sent only to the AI provider you chose.
- **Settings and cached data.** This covers your colors, alerts and cached league data.

**ESPN sign-in.** ESPN's sign-in page opens inside the app. Your password goes to ESPN only. The app saves just ESPN's two login cookies (espn_s2 and SWID) and never reads or stores your password.

## 128BIT LEAGUES (hosted leagues)

If you use 128BIT LEAGUES, these are stored in the league server (a Supabase database):

- **An account ID.** It is anonymous, or tied to your email if you sign in with an email code.
- **Your league data.** This means league and team names, rosters, draft picks, lineup moves, waiver claims, trades and league activity.

Other members of your league can see that league's data. Nobody outside it can.

Scores are calculated on phones from public sports statistics (NHL, MLB, Sleeper, ESPN). No personal data is sent to those services.

**Deleting your account.** Go to Settings → 128BIT LEAGUES → DELETE MY ACCOUNT. This deletes your account, plus any league you run that has no other members.

- In leagues that haven't drafted yet, your team is removed.
- In leagues that have started, your team stays, marked as left and with no owner, so the other members can finish the season.

## What the app does not do

- No ads, and no advertising or tracking SDKs.
- No selling or sharing of personal data.
- No analytics beyond what the services above need to work.

## Third parties

When you use them, the app talks to:

- **Fantasy sites:** Sleeper, Yahoo, ESPN, MyFantasyLeague, Fantrax and Fleaflicker.
- **Public stats sources:** the NHL, MLB, ESPN and Sleeper.
- **The AI provider you pick.**
- **Supabase**, for 128BIT LEAGUES.

Each has its own privacy policy.

**Betting odds.** The app can show betting odds from ESPN's public feed. This is off by default and only for users 21 and over. Bet links open the sportsbook's own app or site. The app does not take bets or handle money.

## Children

The app is not for children under 13. Betting odds are for adults 21 and over only.

## Contact

Questions or deletion requests: open an issue at https://github.com/hootywhooo86/128bitfantasy/issues
