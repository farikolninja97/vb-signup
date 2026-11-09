# Intermediate Court Queue — V1.16

This update is based on **V1.15** and implements audit improvements **2, 3, 4, 5** plus a venue Wi-Fi popup. Priority 1 (empty team advances) was intentionally not changed.

## Install

1. Back up your Supabase database.
2. Open Supabase → SQL Editor → New query. Copy and run the entire text from `supabase/v1.16_supabase_changes.txt`. Check that the final result reports `public_select=true` and `anonymous_write=false`.
3. Copy only the six files in `github-pages/` to the root of `https://github.com/farikolninja97/vb-signup`.
4. **Leave your existing `config.js` alone.** The ZIP deliberately omits it.
5. Refresh both the main page and `/kiosk.html`; both footers should read **V1.16**.
6. Sign into Admin Controls on the main page and set **Guest Wi-Fi information** (SSID and password). Save and test the Wi-Fi popup on both pages.

## Changes

- Kiosk upcoming two teams: larger minimum 14px player names, 15px on smaller screens; scrollable lists for long rosters.
- Main and kiosk 'Last Team Called' panels: grey styling retained, show call time (America/Denver), and no longer claim a team is still on court. Next and Previous logic unchanged.
- More consistent focus trapping, Escape handling, and focus restoration on main dialogs and kiosk PIN/login/Wi-Fi dialogs; kiosk screen readers announce a new first-in-line team instead of rereading the full roster each refresh.
- Header 5–1/6–2 description shortened; full explanation still available through the mandatory welcome dialog and the Review systems button.
- Public venue Wi-Fi popup on both pages; password can be copied with one tap (select-to-copy fallback). Admins can change it in Admin Controls.

## Security note

Wi-Fi name/password are readable by **any visitor** who can open your website, by design. Use a **guest Wi-Fi network**, never a staff/private network or any shared password used elsewhere. The password is stored in your Supabase database, not in GitHub. Only accounts in `admin_users` may change it.

## Checks

JavaScript syntax and static file references are validated locally; simulated UI tests are included in the build verification. Live Supabase and device/browser behaviors still require testing on your actual deployment. No existing players, teams, history, PIN, or other data are deleted by the SQL installer.
