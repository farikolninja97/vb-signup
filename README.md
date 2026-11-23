# Intermediate Court Queue — V1.20

## What changed

1. **Ban Browser Only (admin)** — Each active player/sub entry in Admin > Manage players has a new separate action. It blocks the browser registration identifier without adding a name ban. By default, the action also removes all active signups from the same browser, including group registrations and linked subs. This requires confirmation. The separate **Block Name** action remains available.
2. **Show browser codes (admin-only)** — A checkbox in Manage players and another in Players Today show/hide an abbreviated registration-browser code beside *active* names. Codes are hidden by default and cleared from the admin UI at logout. The full browser token and hash are never displayed. Older signups or archived-only players may have no code available.
3. **Unique names in Players Today totals** — The top counts treat clearly equivalent names as a single entry, ignoring case, surrounding whitespace, accents and punctuation. The review list still shows potentially duplicated entries and their yellow warnings. Fuzzy matches remain separate until a person reviews them; they are not assumed to be one person.
4. **Leave Team directly in the queue** — If this browser owns a player signup or a substitute spot, a **Leave Team** / **Leave Sub Spot** button appears in that team's Live Team Lineup card. The same server-verified private removal token as My Signups is used; other players' signups cannot be removed through this button.
5. Both main website and Kiosk Mode footers display **V1.20**.

## Install

1. Back up your Supabase database first.
2. Open **Supabase > SQL Editor** and paste/run the **entire** `supabase/v1.20_device_only_bans.txt` file. Prerequisites: previous migrations through V1.19 (particularly V1.14 device tracking). This installer does not reset or delete existing player records.
3. Upload **only** the files in `github-pages/` to the same paths in your `farikolninja97/vb-signup` repository.
4. **Do not replace `config.js`**. Keep the configured Supabase project URL and publishable key unchanged.
5. Refresh the homepage and kiosk, check that both footers say **V1.20**, then sign in to Admin Controls and try the browser code toggle.

## How to check

- Under **Manage players**, tick **Show browser codes next to names** and verify codes appear only for tracked active signups. Untick it to hide them.
- Under **Players Today**, the same toggle is available only while signed in as admin. A player who was called long ago or already left may not have a live code.
- Choose a test signup, click **Ban Browser Only**, confirm the warning, and verify it appears in **Blocked browsers (name not blocked)**. You can unblock it there. The name itself should not be added to Blocked players.
- Sign up for a team from a phone, and confirm that phone shows **Leave Team** directly under its team's lineup. A different phone should not show that control for someone else's signup.
- Test names `Jose` and `José` in attendance: both can appear as flagged potential duplicates, but the unique-name count includes them once.

## Security / limitations

- A **browser code is not a physical device ID or a permanent phone ban**. It is a short display of the SHA-256 hash of a random identifier in browser storage. Clearing site storage, switching browsers, changing phones, or deliberately modifying client code can bypass it. Do not treat the short code as a verified identity or phone serial number.
- Because multiple players can register on one shared device, **Ban Browser Only** may remove their registrations too. Confirm carefully. It does **not** automatically ban any names.
- This implementation relies on V1.14's tracked signup workflow. Signups from before device tracking have no browser code; the new button is unavailable for those entries.
- The short browser code is requested through admin-validated Supabase functions, never a publicly readable table. Public lineup and History do not display browser codes.
- Name-based attendance is a convenience metric, **not verified physical attendance**. Distinct people with identical normalized names may be counted as one, while merely similar names are not automatically merged.
- Device-only bans are enforced on the existing tracked registration functions; additional legacy or custom signup endpoints, if enabled, should be reviewed separately for enforcement.

## Tests / limitations of verification

- JavaScript syntax, valid HTML IDs, and browser interaction tests passed for owner-only inline leave, token-backed removal, unique totals with accent variants, admin code hiding/toggle, admin-only device ban, and hiding identifiers after logout.
- The browser tests used simulated Supabase data. The SQL installer is supplied for your real project but **has not been executed against your private Supabase database here**. Verify it in your project before using live blocking at a session.
- No kiosk logic or queue rotation changes. No players or history are intentionally modified during installation; the confirmed browser-ban action is intentionally destructive to matching active signups.
