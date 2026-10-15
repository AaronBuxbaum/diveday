# DiveDay certification check (browser extension)

Checks a diver's certification on the agency's own lookup page, from the staffer's own browser, when they press "Check with SSI" on the diver's record, a departure's Divers tab or Today. A PADI card is checked on DiveChek, on the PADI Pros' Site the staffer is signed in to. It also checks a course student's PADI eLearning on the PADI Pros' Site when a staffer presses "Check eLearning with PADI" on a course roster. Both PADI checks are a per-shop switch, off by default, which an owner or manager turns on: Settings, Bookings & waivers, "PADI checks (beta)". With it off a PADI card keeps its "(member sign-in)" link. The seeded demo shop has PADI checks on, so a browser signed in to the real PADI Pros' Site would have the demo's made-up divers typed into real DiveChek: try the demo in a browser that is not signed in to PADI. Decisions: H-105, H-106, H-121. Design: [ADR 20261008-cert-check-extension](../docs/architecture/decisions/20261008-cert-check-extension.md).

The extension decides nothing. It fills in the agency's form, waits for the answer, and hands the page's text to DiveDay, where `src/lib/agency-check.ts` decides whether the card is certified.

## Files

- `manifest.json`: Manifest V3. Host permissions are the agencies' lookup sites only, PADI's two Pros' Site hosts (`pro.padi.com` and `pros.padi.com`) among them; the content script runs only on DiveDay's staff pages, `https://dive.day/shop/*`.
- `protocol.js`: the wire format. The app's copy is `src/lib/cert-check-extension.ts`.
- `agencies.js`: the lookup page for each agency, which must match `src/lib/agency-verification.ts`, and the eLearning page for each agency it reads (`ELEARNING`, PADI only). PADI opens on `pro.padi.com`, where PADI's own pages send pros, and `origins` lists both PADI hosts, so a tab sent from one to the other is still the signed-in site.
- `fill.js`: finds each box by its name, label or placeholder and the button that sends them, and types nothing until all are found. On a page behind the shop's sign-in (`signIn` in `agencies.js`, PADI) it fills only boxes that search (a search box or landmark, the box's own words, or a form's search button when the form holds no box the lookup does not fill), only on the page the lookup opened when its address names one (DiveChek's `/divechek`), a student's email only into a box that searches or says it is the student's, never on a sign-in, sign-up, account or profile address (`SIGN_IN_PATH` in `protocol.js`) or a page with a password box or an email box that does not search, and presses only the search's own button (Search, Find, Look up, Check, Chek, Verify, or DiveChek's "Run Report"), never a reset and never a bare submit. A box or button inside a hidden block is not on the page. On CMAS's portal, which has a "Search by code" and a "Manual Search", it presses the first search button after the boxes it filled, in the nearest block around them: the code's for a card number, Manual Search for names and birth date, never a date picker's toggle.
- `background.js`: opens the page in a background tab, runs `fill.js`, reads the answer once three reads a second apart agree, closes the tab. Every lookup is filled and read only on its own site (`origins`, or its address's host). For a signed-in page it answers `signed_out` when PADI shows its sign-in or sends the tab to a host outside the spec's `origins`, before the search and again once the answer settles (`pageAsksToSignIn` in `fill.js`), and hands back only the lines about the diver or student searched for: for a diver, each line naming them and the four under it (`RECORD_LINES` in `src/lib/agency-check.ts`), or, when none does, only the lines saying why, at most ten.
- `bridge.js`: on DiveDay's pages, sets the `data-diveday-cert-check` marker and carries messages.

`src/lib/cert-check-extension.test.ts` and `src/lib/cert-check-extension-fill.test.ts` test this folder, and `e2e/agency-check-extension.spec.ts` installs it in a real Chromium against stand-in agency pages: `pnpm e2e:run e2e/agency-check-extension.spec.ts --reporter=line` after `pnpm e2e:build`, with the full Chromium (`pnpm exec playwright install chromium`; the headless shell cannot load an extension).

## Try it locally

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. To try it against `pnpm dev`, add `"http://localhost/shop/*"` to the content script's `matches` in `manifest.json`, and leave it out of anything you publish. Chrome ignores the port in a match pattern, so a published localhost pattern would let any local web app use the extension.
3. Choose "Load unpacked" and pick this folder.
4. Open a diver's record with a pending level card from one of the six agencies. "Check with <agency>" is now a button. A PADI card needs the diver's birth date on file and the shop's "PADI checks (beta)" switch on.

Settings, Bookings & waivers, "Certification checks", says whether this browser has it.

## Test the PADI eLearning check

The PADI page is a best guess (#2259). To test it for real:

1. Load the extension as above and sign in to the PADI Pros' Site in the same browser.
2. Open a PADI course session with learning materials, and a student whose eLearning you know is finished. Open their row's details and press "Check eLearning with PADI".
3. If it answers "Couldn't read PADI's page", open `https://pro.padi.com/` yourself, find where a student's eLearning is searched, and correct `ELEARNING.padi` in `agencies.js` (the page address) and, if the search box is not found, `PATTERNS.email` in `fill.js`.
4. If it reads the page but gets the answer wrong, copy the page's text into a new case in `src/lib/elearning-check.test.ts` and fix `judgeElearningPage`.

## Test DiveChek against the real page

Moved to the [cert-check extension runbook](../docs/engineering/cert-check-extension-runbook.md): the session anyone with Chrome runs against the public lookups, the PADI session with the first pilot shop's Pro, how to read what they send back, and the exits from "beta".

## Publish

`node scripts/pack-extension.mjs` writes the zip, leaving out this README and `store/`, and refuses a localhost match or a `manifest.json` version that `protocol.js` does not announce. The listing text is [store/listing.md](store/listing.md); the steps are the runbook's [Publishing](../docs/engineering/cert-check-extension-runbook.md#publishing). Once the listing exists, put its address in `EXTENSION_STORE_URL` (`src/lib/cert-check-extension.ts`), and Settings shows "Add to Chrome".
