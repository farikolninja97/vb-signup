# Intermediate Court Queue — V1.07

## What changed

Kiosk Mode now keeps the **first team and its roster large** and adds a **compact square in the lower-right** displaying the **next two waiting teams and all their player names**. This includes SUB labels for substitutes. If there are fewer than two following teams, only the available teams appear; with none, a message is shown. The preview is refreshed along with the main roster by the existing Realtime channel and 60-second fallback.

On landscape tablets and monitors, the small square sits at the bottom-right of the first-team card. On narrow phone screens it shifts beneath the primary roster and stays right-aligned so it never covers player names or the Next / Previous buttons.

The site footer and cache references advance to **V1.07** on both the normal homepage and the kiosk.

## Upload only these changed files to the repository root

- `index.html` — version footer and cache references for V1.07.
- `kiosk.html` — new upcoming-teams square and V1.07 footer/cache references.
- `kiosk.css` — layout and styling for the compact upcoming-teams square.
- `kiosk.js` — renders the next two teams with player names from the same live Supabase queue data.

**Do not overwrite your existing `config.js`, `app.js`, or `styles.css`.** Those files have no changes in this update.

## Installation

1. Open https://github.com/farikolninja97/vb-signup and replace the four changed files listed above, keeping them in the repository root (next to `config.js`).
2. Wait for the GitHub Pages deployment to finish in GitHub Actions.
3. Refresh https://farikolninja97.github.io/vb-signup/kiosk.html and check the footer displays **V1.07**.
4. Confirm that Team 1 remains prominent and the small bottom-right panel shows Team 2 and Team 3 with the players currently registered. Press **Next Team** then **Previous Team** to verify it updates/restores correctly.

No Supabase SQL changes are required. The existing queue data, History, admin controls, themes and public Next/Previous functions remain unchanged.

## Verification performed

- JavaScript syntax check passed.
- Browser tests using simulated Supabase data passed at 1280×720, 1024×768, 800×600, and 390×844 for two following teams, member names, substitute labels, Next/Previous, the Halloween theme, and V1.07 footer.
- The layout is responsive; on a narrow phone the panel may require scrolling, but it does not obscure the main roster or action buttons.
- This update was not deployed to your GitHub repository and has not been tested against your live Supabase data.
