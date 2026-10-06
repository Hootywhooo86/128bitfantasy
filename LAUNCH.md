# Launch checklist

To put 128BIT FANTASY in front of other people, work through these in order. ✅ = already done in the app.

## 1. One league server for everyone (about 15 minutes)

Today, each league would need its own Supabase project. For the public, run one server, built into the app.

1. **Create the project.** At supabase.com, create a project called `128bitfantasy`, close to most of your users (US West).
2. **Add the tables.** In SQL Editor, paste all of `supabase/schema.sql` and click Run. Re-run it after any app update that changes it.
3. **Turn on sign-in.** Go to Authentication → Sign In / Providers:
   - Turn on **Allow anonymous sign-ins**.
   - Keep **Email** on.
4. **Set up email.** Supabase's built-in email sends only a few messages an hour.
   - Go to Authentication → Emails → SMTP Settings and add a free sender, such as Resend (3,000 emails a month free) or Brevo.
   - In Emails → Magic Link, add `{{ .Token }}` to the email body so people get a 6-digit code.
5. **Bake the server into the app.** In GitHub, go to the repo → Settings → Secrets and variables → Actions → **Variables** and add:
   - `SUPABASE_URL` = the Project URL.
   - `SUPABASE_PUBLISHABLE_KEY` = the publishable key. It is public by design. Never use the secret key here.

   The next APK build has them built in. People then just open Settings → 128BIT LEAGUES and sign in, with nothing to paste.

✅ The app uses the built-in server automatically. "Use a different project" is still there for anyone who wants their own.

**Cost.** The free plan covers 50,000 monthly users and 500 MB, which is plenty to start. Free projects **pause after 7 days with no activity**. Once real people depend on it, move to Pro ($25 a month): no pausing, daily backups and more room.

## 2. Accounts and privacy (required by the app stores)

- ✅ In-app **DELETE MY ACCOUNT** (Settings → 128BIT LEAGUES).
- ✅ Privacy policy: `PRIVACY.md`. The stores need it at a public URL. Turn on GitHub Pages (repo → Settings → Pages → from `main`) or paste it into any web page, then use that link.
- Put a contact email in the privacy policy (it currently points to GitHub issues).

## 3. Google Play (Android)

1. **Developer account.** Create a Google Play Console account: $25 once, plus ID verification, which can take a few days.
2. **New-account testing rule.** New personal accounts must run a closed test with **at least 12 testers for 14 days** before going public. Start this early. Friends from your leagues count.
3. **Build an app bundle.** Play wants an **AAB** signed with your upload key, not the APK. I can add an `eas build` or a Gradle `bundleRelease` step to the workflow when you're ready. It needs a keystore you keep safe.
4. **Store listing.** You need:
   - A name and description.
   - Screenshots (2–8 phone shots).
   - A 512×512 icon (the whistle) and a 1024×500 feature graphic.
5. **Content rating questionnaire.**
6. **Data safety form.**
   - Collected: account ID or email, user content (league data).
   - Not collected: ads, location, contacts.
   - Data is encrypted in transit, and it can be deleted.
7. **Betting odds.** Google Play has strict rules for gambling-related content, and links that open sportsbooks count. The safest launch is with **odds off and bet links removed** in the store build. Odds-only information is generally fine, but bet links need Google's gambling-app approval and licences. I can add a build switch that turns them off.

## 4. Apple App Store (iPhone), later

- An Apple Developer account ($99 a year) and a Mac or EAS cloud builds.
- The same privacy, account-deletion and gambling rules apply.

## 5. Provider rules to keep in mind

- **Yahoo:** the public app needs Yahoo's Fantasy API approval (sports.yahoo.com/developer) before anyone's Yahoo leagues load. Use your own Yahoo app's Client ID as the built-in one: as a public client it has no secret to protect.
- **ESPN:** unofficial and read-only by default. READ & WRITE is opt-in, with a warning that ESPN can block it at any time. Don't market ESPN lineup changes as a feature.
- **Sleeper, MFL, Fleaflicker:** official public APIs. Stay within their rate limits; the app already caches.
- **Names and logos:** don't use NHL, NFL, NBA or MLB team logos or league marks in store art. Stick to your whistle and pixel style.

## 6. Before you invite strangers

- Run a real league with friends through a draft and a few weeks of scoring. Report anything odd.
- Basketball starts October 20, so that's a good first live test for daily lineups and live points.
- Watch Supabase → Logs during the first draft.
- Keep the daily API watch (GitHub Actions) on. It emails you if a sports feed changes.
