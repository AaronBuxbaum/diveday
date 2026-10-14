# DiveDay certification check (browser extension)

Checks a diver's certification on the agency's own lookup page, from the staffer's own browser, when they press "Check with SSI" on the diver's record, a departure's Divers tab or Today. A PADI card is checked on DiveChek, on the PADI Pros' Site the staffer is signed in to. It also checks a course student's PADI eLearning on the PADI Pros' Site when a staffer presses "Check eLearning with PADI" on a course roster. Decisions: H-105, H-106, H-114. Design: [ADR 20261008-cert-check-extension](../docs/architecture/decisions/20261008-cert-check-extension.md).

The extension decides nothing. It fills in the agency's form, waits for the answer, and hands the page's text to DiveDay, where `src/lib/agency-check.ts` decides whether the card is certified.

## Files

- `manifest.json`: Manifest V3. Host permissions are the agencies' lookup sites only; the content script runs only on DiveDay's staff pages, `https://dive.day/shop/*`.
- `protocol.js`: the wire format. The app's copy is `src/lib/cert-check-extension.ts`.
- `agencies.js`: the lookup page for each agency, which must match `src/lib/agency-verification.ts`, and the eLearning page for each agency it reads (`ELEARNING`, PADI only).
- `fill.js`: finds each box by its name, label or placeholder, fills it, and submits. On a page behind the shop's sign-in (`signIn` in `agencies.js`, PADI) it fills only boxes that search, never on a sign-in, sign-up, account or profile page or one with a password box, and presses only the search's own button.
- `background.js`: opens the page in a background tab, runs `fill.js`, reads the answer, closes the tab. For a signed-in page it answers `signed_out` when PADI shows its sign-in, and hands back only the lines about the diver or student searched for.
- `bridge.js`: on DiveDay's pages, sets the `data-diveday-cert-check` marker and carries messages.

`src/lib/cert-check-extension.test.ts` and `src/lib/cert-check-extension-fill.test.ts` test this folder.

## Try it locally

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. To try it against `pnpm dev`, add `"http://localhost/shop/*"` to the content script's `matches` in `manifest.json`, and leave it out of anything you publish. Chrome ignores the port in a match pattern, so a published localhost pattern would let any local web app use the extension.
3. Choose "Load unpacked" and pick this folder.
4. Open a diver's record with a pending level card from one of the six agencies. "Check with <agency>" is now a button. A PADI card needs the diver's birth date on file.

Settings, Bookings & waivers, "Certification checks", says whether this browser has it.

## Test the PADI eLearning check

The PADI page is a best guess (#2259). To test it for real:

1. Load the extension as above and sign in to the PADI Pros' Site in the same browser.
2. Open a PADI course session with learning materials, and a student whose eLearning you know is finished. Open their row's details and press "Check eLearning with PADI".
3. If it answers "Couldn't read PADI's page", open `https://pros.padi.com/` yourself, find where a student's eLearning is searched, and correct `ELEARNING.padi` in `agencies.js` (the page address) and, if the search box is not found, `PATTERNS.email` in `fill.js`.
4. If it reads the page but gets the answer wrong, copy the page's text into a new case in `src/lib/elearning-check.test.ts` and fix `judgeElearningPage`.

## Test DiveChek against the real page

The DiveChek page is a best guess, like the eLearning page (#2259), and the same sitting should try both. Before relying on it, someone should also read the PADI Pros' Site terms (H-114).

1. Load the extension as above. Do not sign in to PADI yet.
2. Open a diver's record with a pending PADI level card and a birth date, and press "Check with PADI". It should answer "Sign in to PADI first, then check again." If it says "Couldn't read PADI's page" instead, note the address PADI sent the tab to (open DiveChek yourself while signed out) and add its path or host to `SIGN_IN_PATH` in `background.js` and the matching pattern in `fill.js`.
3. Sign in to the PADI Pros' Site in the same browser. Find DiveChek yourself and note its address and its search boxes.
4. Press "Check with PADI" on a diver whose PADI card you know. If it answers "Couldn't read PADI's page", correct `AGENCIES.padi.url` in `agencies.js` and `checkUrl` in `src/lib/agency-verification.ts` (the two must match, and a test holds them together). If the boxes are not found, check that their labels name first name, last name and birth date and that the search's own button says Search or Find, and adjust `PATTERNS` in `fill.js`. If the birth date lands in the wrong order, change `dateFormat`.
5. If it reads the page but gets the answer wrong, copy the page's text (only the diver's lines) into a new case in the "judgeAgencyPage on PADI DiveChek" block of `src/lib/agency-check.test.ts` and fix `LEVEL_WORDING.padi` or the rule. A results table whose header says "Instructor" will read as limiting: check what the result rows look like.
6. Try a diver with a common name: a page listing several divers must answer "PADI lists more than one diver by this name." and certify nothing.

## Publish

1. Bump `version` in `manifest.json` and `VERSION` in `protocol.js` together. A test holds them equal.
2. Zip this folder's contents, leaving out this README.
3. Upload to the Chrome Web Store developer dashboard. The listing needs a privacy policy URL and a reason for each host permission: "Fills in this agency's public certification lookup form when the user asks, and reads the answer."
4. Edge Add-ons accepts the same zip.
5. Put the listing's address in `EXTENSION_STORE_URL` (`src/lib/cert-check-extension.ts`). Settings then shows "Add to Chrome".
