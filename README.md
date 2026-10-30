# Intermediate Court Queue — V1.06

## Changed files — upload these to your GitHub Pages repository root

- `index.html` — branded top link now goes to https://farikolninja97.github.io/vb-signup/, adds **Kiosk Mode** link, footer updated to V1.06.
- `styles.css` — new home/kiosk header links for all themes, with mobile styling.
- `kiosk.html` — new, standalone kiosk-only page; shows just the first team, its roster, and large public Next/Previous actions, with discreet Home and fullscreen options.
- `kiosk.css` — screen-filling responsive kiosk layout for tablets, landscape displays, phones, and holiday palettes.
- `kiosk.js` — reads the live queue and members, calls existing `advance_global_queue` / `undo_global_queue` functions, listens to the same Supabase broadcast topic as the main app, uses a 60-second fallback and reconnect refresh.

**DO NOT overwrite your existing `app.js` or `config.js`.** No database migrations or Supabase SQL changes are required if your existing public Next/Previous and Realtime broadcasts already work.

## Installation

1. Back up your GitHub repository files if desired.
2. Upload the four website files (`index.html`, `styles.css`, `kiosk.html`, `kiosk.css`) and `kiosk.js` into the repository root, next to your existing `app.js` and `config.js`.
3. Wait for GitHub Pages deployment to finish, then refresh your site. Check for **Current Version: V1.06** at the bottom.
4. On your homepage, click **Kiosk Mode** (near Admin Login), or visit `https://farikolninja97.github.io/vb-signup/kiosk.html`.
5. On a compatible browser, tap **Fullscreen** to hide browser chrome. For iPhones or browsers that don't support this fullscreen API, the button is hidden; use the browser's display mode or add the website to your Home Screen.
6. Verify the displayed team and player names. Try Next, then Previous, on a test team. Both buttons are public, just like your main page.

## Behavioral details

- Kiosk Mode has **no signup form, directory, history tab, or admin panel**. It deliberately bypasses the first-visit rules popup because it's a display and queue-control page, not a signup entry page.
- The homepage retains its V1.05 acknowledgment popup, signups, themes, alerts, and all admin functionality.
- Next calls `advance_global_queue` and Previous calls `undo_global_queue`. The existing Supabase routines handle archiving/restoring rosters and keeping history. The Previous button is disabled if history is empty.
- Queue and theme updates arrive from your current Supabase Broadcast channel. A 60-second refresh and foreground/reconnection refresh protect against missed events.
- Both pages display **V1.06** at the bottom. Your configured Supabase URL/key stay in your existing `config.js`, which is intentionally absent from this ZIP.

## Testing and scope

- JavaScript syntax checked (`node --check`).
- Browser smoke tests with a simulated Supabase database passed at 1280x720, 800x600, and 390x844. Tested first-team roster, six preferred positions, Next, Previous, and Halloween theme rendering.
- The app has **not** been deployed to your GitHub repository or tested against your live Supabase project. This ZIP contains the files you need to publish.
