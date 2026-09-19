# Publishing TopDown for LinkedIn to the Chrome Web Store

Everything code-side is ready. The remaining steps need Jason's Google account.

## One-time setup (Jason)

1. Register a Chrome Web Store developer account ($5):
   https://chrome.google.com/webstore/devconsole/register
2. Verify a domain or set up a publisher identity if listing publicly under topdown.sh.

## Package

```bash
cd extension
npm run pack        # builds + zips dist/ → extension/topdown-extension.zip
```

Upload `topdown-extension.zip` in the developer console → Items → New item.

## Store listing fields

- **Name:** TopDown for LinkedIn (from manifest)
- **Description (manifest):** already set; expand for the listing, e.g.
  "Build stakeholder and org maps for your B2B accounts. One click adds the
  LinkedIn profile or Sales Navigator lead list you're viewing to your TopDown
  roster — no copy-paste."
- **Category:** Productivity (or Workflow & Planning)
- **Icon:** `dist/icons/icon128.png` is already the required 128×128 store icon
- **Screenshots (required):** at least one 1280×800 (or 640×400) PNG. Capture:
  a LinkedIn profile page with the extension's "Add to TopDown" affordance
  visible, and the popup after a successful import. Needs a real LinkedIn
  session — can't be generated synthetically.
- **Small promo tile (optional):** 440×280 PNG.
- **Privacy policy URL (required):** https://topdown.sh/privacy — shipped with
  this PR. **Confirm `support@topdown.sh` receives mail before submitting**,
  or update `web/src/pages/PrivacyPage.tsx` with a real contact.

## Permission justifications (reviewer form)

- `storage`: saves the user's extension settings (API endpoint, token).
- `activeTab` + `scripting`: parses the current LinkedIn page only when the
  user clicks the toolbar button or an in-page button the user pressed.
- `host_permissions` `https://api.topdown.sh/*`: the API that stores imported
  profiles in the user's workspace.
- `optional_host_permissions` `https://*/*` + `http://localhost/*`: requested
  at runtime only when the user configures a custom API endpoint (self-hosted
  or local development); never requested by default.
- `content_scripts` on `https://www.linkedin.com/*`: renders the import UI and
  reads profile fields on explicit user action; collects nothing passively.

**Single purpose:** import LinkedIn people into a TopDown roster.
**Data usage compliance:** check "does not sell user data", "not for purposes
unrelated to the single purpose", "no creditworthiness/lending use".

## After submission

- Review typically takes a few days; they may ask for a video showing the
  extension in action — record one on a LinkedIn profile + Sales Nav list.
- To push updates: bump `version` in `public/manifest.json` and
  `extension/package.json`, `npm run pack`, upload the new zip.
- Internal/unlisted distribution is possible first (visibility: Private or
  Unlisted) if you want to dogfood before a public listing.
