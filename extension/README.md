# DiveDay certification check (browser extension)

Checks a diver's certification on the agency's own lookup page, from the staffer's own browser, when they press "Check with SSI" on the diver's record. Decision: H-105. Design: [ADR 20261008-cert-check-extension](../docs/architecture/decisions/20261008-cert-check-extension.md).

The extension decides nothing. It fills in the agency's form, waits for the answer, and hands the page's text to DiveDay, where `src/lib/agency-check.ts` decides whether the card is certified.

## Files

- `manifest.json`: Manifest V3. Host permissions are the agencies' lookup sites only; the content script runs only on DiveDay's staff pages, `https://dive.day/shop/*`.
- `protocol.js`: the wire format. The app's copy is `src/lib/cert-check-extension.ts`.
- `agencies.js`: the lookup page for each agency. They must match `src/lib/agency-verification.ts`.
- `fill.js`: finds each box by its name, label or placeholder, fills it, and submits.
- `background.js`: opens the page in a background tab, runs `fill.js`, reads the answer, closes the tab.
- `bridge.js`: on DiveDay's pages, sets the `data-diveday-cert-check` marker and carries messages.

`src/lib/cert-check-extension.test.ts` and `src/lib/cert-check-extension-fill.test.ts` test this folder.

## Try it locally

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. To try it against `pnpm dev`, add `"http://localhost/shop/*"` to the content script's `matches` in `manifest.json`, and leave it out of anything you publish. Chrome ignores the port in a match pattern, so a published localhost pattern would let any local web app use the extension.
3. Choose "Load unpacked" and pick this folder.
4. Open a diver's record with a pending level card from one of the five agencies. "Check with <agency>" is now a button.

Settings, Bookings & waivers, "Certification checks", says whether this browser has it.

## Publish

1. Bump `version` in `manifest.json` and `VERSION` in `protocol.js` together. A test holds them equal.
2. Zip this folder's contents, leaving out this README.
3. Upload to the Chrome Web Store developer dashboard. The listing needs a privacy policy URL and a reason for each host permission: "Fills in this agency's public certification lookup form when the user asks, and reads the answer."
4. Edge Add-ons accepts the same zip.
5. Put the listing's address in `EXTENSION_STORE_URL` (`src/lib/cert-check-extension.ts`). Settings then shows "Add to Chrome".
