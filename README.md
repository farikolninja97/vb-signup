# Intermediate Court Queue V1.09 — Kiosk preferred-position visibility fix

## Fix
The kiosk previously treated a missing/null `show_player_positions` setting as permission to show positions. Now it hides them until Supabase explicitly returns `true`. A CSS guard prevents stale position text from remaining visible if settings are unavailable. An admin setting change also requests an immediate refresh through the existing Realtime channel. A small kiosk footer label shows **Positions hidden** or **Positions shown**, allowing you to verify the value the kiosk received.

The following-team panel continues to display names and SUB badges only. No player positions are deleted from Supabase, and signup still requests the player's position.

## Install
1. Upload only the **five changed files** from `github-pages/` to the root of your GitHub repository, replacing the existing copies:
   - `index.html`
   - `app.js`
   - `kiosk.html`
   - `kiosk.js`
   - `kiosk.css`
2. Do not replace `config.js`, `styles.css`, or any other files.
3. Wait for GitHub Pages to finish deploying, then refresh both `/vb-signup/` and `/vb-signup/kiosk.html` (hard refresh if needed).
4. Verify **Current Version: V1.09** on both screens.
5. Sign in to Admin and uncheck **Show player preferred positions**. Kiosk should show **Positions hidden** in its footer; names and SUB badges remain visible, but no positions are displayed in the primary roster.
6. Check the box again to verify kiosk positions return.

## Supabase
**No SQL migration is required** if you already ran V1.08's visibility migration. This update changes frontend behavior only.

To verify the actual shared setting, use Supabase SQL Editor:

```sql
SELECT id, show_player_positions FROM public.queue_settings WHERE id = true;
```

When the admin box is unchecked the result must be `false`. If it stays `true`, the admin change is failing to save; don't disable RLS or use unrestricted table grants to work around this.

Kiosk display settings are UI-only. This doesn't remove preferred positions from the public database API.
