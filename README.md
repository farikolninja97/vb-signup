# Intermediate Court Queue V1.10

Based on the accepted V1.09 release (NOT the discarded 2–3-teams-per-court update).

## What's changed

- Prominent **Sign Up to Play** button at the top opens a mobile-friendly popup; signup form is no longer embedded in the page.
- Regular player and substitute signups no longer ask for a preferred position. For backwards compatibility, the existing database records `Flexible / Any` internally. That generic placeholder is not displayed on rosters; older player positions remain where applicable and the admin visibility toggle still works.
- **Next Team is admin-only**, on homepage and kiosk. The kiosk includes an Admin sign-in / sign-out button. Database RPC enforces admin membership; bypassing the UI won't work.
- **Previous Team remains public**, as requested. Anyone can still undo a queue advance; restrict it separately if necessary.
- A player can sub only if they already have an active regular-team signup on this device **and** that team is at least three queue positions behind the first team. The server checks the original signup, private ownership token, real queue order, team capacity and duplicate-sub constraints.
- History, holiday themes, 60-second Realtime fallback, kiosk next-two-team panel, reset, and the V1.10 footer remain.

## Install in order

1. **Back up Supabase data** and run `supabase/v1.10_admin_next_registered_subs.sql` in Supabase SQL Editor. Check all six verification columns show `true`.
2. Upload **only the changed files** in `github-pages/` to the ROOT of https://github.com/farikolninja97/vb-signup, replacing same-named files.
3. Do NOT change `config.js`. Do not upload the SQL file to GitHub Pages.
4. Open the main website and kiosk; check **V1.10** in each footer. Refresh any cached tabs.
5. Try Next logged out (should be unavailable); sign in with an `admin_users` account (works). On kiosk, use the Admin sign-in at the top.
6. Test subbing with a registered player on the fourth queued team (should work) and with players on the first three teams or unregistered (blocked). Test Previous restores team and roster, and signup popup on a phone.

## Database compatibility

No tables or existing signups are deleted. The migration renames the two existing V1.09 functions to private/internal names and installs guarded wrappers under their original RPC names; it is idempotent. It does **not** recreate or reset teams. Because a public signup does not use Auth, substitute ownership requires the original registration device and its locally saved private token. Old signups without such a token cannot sub until re-registered or otherwise moved by an admin.

The SQL and browser controls require live testing against your Supabase project after deployment. Do not consider UI-only test passes an RLS/security audit.
