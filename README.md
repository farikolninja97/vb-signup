# Intermediate Court Queue — V1.15

**Based on V1.14.** Update both the homepage and the fullscreen kiosk.

## Changes
- The recently called team (and its saved player roster) is shown in a **muted grey ON COURT** panel instead of looking like another team waiting in line. This is read-only and does **not** press Previous or change History.
- Admin Controls now show **Resume Day — Reopen registration** after End Day was clicked. Resume keeps all teams, signups, court ordering, substitute assignments, previous team, and the past 30 days of History. It changes only the `queue_settings.registration_closed` flag.
- **Kiosk Mode:** the just-called team uses the same grey ON COURT treatment; the kiosk displays whether signups are open or closed; signed-in admins see a small **Resume Day** button at the top when the day is closed. Non-admin kiosk users cannot resume.
- The original Next / Previous PIN controls, multi-player signup, holiday themes and notifications are unchanged.

## Installation
1. Back up your Supabase database (recommended).
2. Open `supabase/v1.15_supabase_changes.txt`. Copy all its text into **Supabase → SQL Editor** and run it. Both final checks should say `true`. **Running this script will NOT reopen the day or delete anyone.**
3. Upload ONLY the six files inside `github-pages/` to the **root** of `https://github.com/farikolninja97/vb-signup`: `index.html`, `app.js`, `styles.css`, `kiosk.html`, `kiosk.js`, `kiosk.css`.
4. **Keep `config.js` unchanged.** Do not re-run older schema scripts or Reset to install this update.
5. Wait for GitHub Pages to deploy, refresh both `https://farikolninja97.github.io/vb-signup/` and `https://farikolninja97.github.io/vb-signup/kiosk.html`, and check the visible footer says **V1.15** on both.

## Try it
1. Sign in as admin on homepage, press End Day. Signups become disabled; both pages display the closed state.
2. Look at **Admin Controls → Resume Day**. Press it, confirm, then check that the day reopens while all players and teams remain.
3. On the kiosk, sign in with your admin account via the top-right admin control. End the day from the main page; the kiosk should show a small **Resume Day** control in the top bar after its live update. Press to reopen registration. Without an admin login, it must not appear.
4. Press Next using your PIN or admin account. The team just called, including each player's name, appears in grey as **ON COURT**, both on homepage and kiosk. Previous should restore that same team and remove it from the On Court panel.

## Verification scope
Frontend syntax and local assertions can be checked without connecting to the private database. The SQL needs to be run in your own Supabase project; verify admin authorization and live multi-device sync after deployment.

**Next version: V1.16.**
