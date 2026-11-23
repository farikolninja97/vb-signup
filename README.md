# Intermediate Court Queue — V1.19 (Players Today name review)

Based on V1.18. Adds **visual name-review flags only to the Players Today tab**.

## Install

1. Upload the **four changed website files** in `github-pages/` to the root of your existing GitHub Pages repository: `https://github.com/farikolninja97/vb-signup`.
2. Overwrite the matching files: `index.html`, `app.js`, `styles.css`, `kiosk.html`.
3. **Do not replace** your configured `config.js` or the unchanged `kiosk.js` / `kiosk.css`.
4. Reload the main site and kiosk. Both footers should read **V1.19**.

**Supabase: NO CHANGES REQUIRED.** There is no database migration for V1.19.

## How name review works

The rules run *only on the names displayed for the selected date* in the Players Today tab:

- **Yellow – Potential duplicate:** Two names on that date are nearly the same. Examples: `Jose` vs `José`, `John Smith` vs `Jon Smith`, or `Luis R` vs `Luis Rodriguez`. Both names stay in the list, with a hint pointing to the possible match. Different real people can have similar names.
- **Red – Possible fake/test name:** Clear placeholders such as `Test User`, `Player 1`, `Jane Doe`, `asdfgh`, or an all-symbol/no-letter entry. These are *review suggestions*, not proof of a fake identity.
- **Normal:** No review cue found.
- **Repeated identical names** are already consolidated into one Players Today entry by V1.18's attendance logic. Reappearing on different teams is not itself marked as duplicate.

The code does not automatically reject, block, remove, or rename any player. It doesn't change the signup form, team queue, History tab, admin management, or kiosk roster display. Admins should verify any flags manually.

## Tests performed

- `node --check` on V1.19 `app.js`.
- Test fixtures for accent variants, small typos, surname initials, placeholder names, and ordinary names.
- Verified unique HTML IDs, valid references to new attendance elements, CSS scoped to attendance, and version text on both HTML pages.

This package has not been tested against your private live Supabase data. No live deployment changes were made.
