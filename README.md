# Intermediate Court Queue — V1.05

## What changed

Added a required first-visit volleyball knowledge popup, explaining 5–1 and 6–2 systems. Visitors cannot proceed until they check the acknowledgment and press **I understand — enter queue**. It remembers acceptance in this browser using localStorage, not Supabase; the modal will reappear in private browsing, on other devices, or after clearing site data. A **Review 5–1 / 6–2 requirements** button is available in the footer. The footer version is **V1.05**.

The popup is an acknowledgment, not a test or a server-side eligibility verification. It does not identify the person. Admins/players on a new browser also see it.

## Deployment (only 2 changed files)

1. Upload `index.html` and `styles.css` from this ZIP to your GitHub Pages repository root, replacing the existing files.
2. **Keep `app.js` and your configured `config.js` unchanged.** Don't re-run any database migrations.
3. Wait for GitHub Pages to finish deploying, refresh and check the footer: **V1.05**.
4. On a browser that has not accepted the new policy, verify the button stays disabled until the checkbox is checked.
5. Test on a phone. After accepting once, reload to confirm it doesn't appear again. Use the footer link to review the policy.

No Supabase SQL changes. Current queue, public Next/Previous, team history, admin functions, themes, ringtone, and signup functionality remain unchanged.

## Notes

The gate is client-side: advanced users can bypass it using browser developer tools. Use a server-side policy if you ever require legally enforceable consent or formal participant verification.
