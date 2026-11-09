# Intermediate Court Queue — V1.17 iPhone Kiosk Repair

This patch is based on the accepted V1.16 version. **No Supabase changes are needed.**

## Install
1. Open your `farikolninja97/vb-signup` GitHub repository.
2. Replace the **three** files inside `github-pages/`: `index.html`, `kiosk.html`, and `kiosk.css`.
3. **Do not replace** `app.js`, `kiosk.js`, `styles.css`, or your configured `config.js`.
4. After GitHub Pages deploys, reopen `https://farikolninja97.github.io/vb-signup/kiosk.html` on the iPhone; refresh the page (or close/reopen the Home Screen web app).
5. Confirm the footer says `V1.17` on the main site and kiosk.

## Fixes
- Next Team and Previous Team stay **visible at the bottom** on iPhone portrait and landscape, even with full rosters or on a short screen.
- The next-two-team panel automatically grows instead of forcing names into a small, clipped square on iPhone.
- Safe-area padding accommodates the iPhone home indicator.
- PIN and admin sign-in inputs use at least 16px text, avoiding Safari's automatic zoom on focus; their dialogs scroll when the keyboard is open.
- **Tablet/desktop kiosk appearance is intentionally unchanged**. All existing queue, History, PIN, theme, Realtime and Wi-Fi functions remain in their existing JavaScript files.

## Validation / limitations
Checked with an offline fake Supabase database in Playwright Chromium mobile viewport emulation at portrait and landscape screen sizes, including a full next-two-team roster and the 4-digit PIN prompt. Real iPhone Safari and live Supabase still need testing after installation.

## Supabase
**No Supabase SQL/TXT migration needed for V1.17.**
