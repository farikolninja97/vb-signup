# Intermediate Court Queue — V1.04 — COS Volleyball branded theme

Adds **COS Volleyball · Colorado Springs Pickup** to the existing Admin → Website theme selector.
It uses the real branding from https://cosvolleyball.github.io/ : navy `#072b44`, teal `#008b95`, cyan `#19d4e3`, green `#45ce5e`, white cards, DM Sans / Barlow Condensed typography, the official volleyball hero photo, and the official logo/favicon.

## Installation (in order)

1. Back up your Supabase database/settings before making SQL changes.
2. Supabase → SQL Editor → New Query: paste and run **`add_cosvolleyball_theme.sql`**. This **only extends the existing theme constraint**, and does not modify any signups, teams, courts, queue state, or admin accounts.
3. Replace only **`index.html`**, **`app.js`**, and **`styles.css`** at the root of your `vb-signup` GitHub Pages repository.
4. **Keep your working `config.js` as-is.** Never upload a service_role or secret Supabase key.
5. Wait for GitHub Pages deployment, refresh the website, and verify **Current Version: V1.04** at the very bottom.
6. Admin → Website theme → **🏐 COS Volleyball · Colorado Springs Pickup**. Selecting previews it; click **Apply theme** to save for everyone. Refresh to verify persistence.

## Original brand assets

The theme references these **unchanged original assets from your other website**. It does *not* copy or embed the unrelated event-registration site's JS, database credentials, or personal information:

- Hero photo: https://cosvolleyball.github.io/court-hero.webp
- Brand volleyball icon/logo: https://cosvolleyball.github.io/favicon-192.png
- Browser icon: https://cosvolleyball.github.io/favicon-32.png
- Apple Home Screen icon: https://cosvolleyball.github.io/apple-touch-icon.png
- Fonts: Barlow Condensed and DM Sans, delivered via Google Fonts.

All are fetched by browsers when the COS Volleyball theme is selected. This keeps the ZIP lightweight and the branding visually consistent with your other website. If you want **entirely local asset copies** in `vb-signup`, download the images from the public repo https://github.com/cosvolleyball/cosvolleyball.github.io and update the `https://cosvolleyball.github.io/` references in `styles.css` and `app.js` / `index.html` to local paths.

## Compatibility

Based on existing V1.03 source. All previous themes, realtime/60s fallback, queue logic, signup, self-leave, sub rules, Next/Previous, history, notifications/ringtone and reset code are untouched. The COS theme is styling only, plus one option in the admin selector and saved-theme allowlist. All other themes and Default remain unchanged.

## Testing

- `node --check` passed for `app.js`.
- HTML/CSS and preserved selectors validated statically.
- Needs a live Supabase test to verify `queue_settings.site_theme = 'cosvolleyball'` and asset loading on your deployed GitHub Pages website.
