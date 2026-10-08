# 20261008-cert-check-extension — Check a card on the agency's own page from the staffer's browser

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

No agency offers a certification API ([H-10](../../product/human-decisions/README.md)), so [20260721-manual-certification](20260721-manual-certification.md) made certifying a manual lookup, and a card waiting for one carries a link to its agency's public lookup page (`src/lib/agency-verification.ts`). The staffer still opens the page, types the diver in, reads the answer and comes back to tap **Mark certified**. DiveDay's servers cannot do that lookup for them: the pages are the agencies', meant for a person, and PADI's sits behind the shop's own member sign-in. The staffer's browser can. Aaron asked for a browser extension that does the lookup from there, shows only when installed, falls back to the link, and is offered from Settings ([H-105](../../product/human-decisions/README.md)).

## Decision

- **A Manifest V3 extension, `extension/` at the repo root**, plain scripts with no build step and no dependencies. Chrome and Edge first. It holds host permissions for exactly the agencies it checks (SSI, NAUI, SDI, GUE, CMAS). Its content script runs only on DiveDay's staff pages (`https://dive.day/shop/*`), and the service worker answers only the top frame of one. A localhost pattern is for local testing and is never published, because Chrome ignores the port in a match pattern.
- **The extension carries words and decides nothing.** On a request it opens the agency's lookup page in a background tab, fills the form by what each box says about itself (`extension/fill.js`), waits for the answer to settle, hands the page's text back and closes the tab. If a box the lookup needs is missing it submits nothing.
- **The verdict is the server's.** `agencyCheckAction` reloads the card and the diver from the database and `judgeAgencyPage` (`src/lib/agency-check.ts`) reads the text as records: a line with the diver's first and last names in order, and the few lines after it up to the next line naming them again. A record matches only when it also carries the birth date or card number the lookup was typed with (so a namesake is not certified, and the next row's level is not read as theirs), states the claimed level in that agency's own wording, and says nothing limiting (junior, referral, student, online, restricted, a try-dive, a trainer's title). Divemaster and instructor never match, and neither does a TDI card, whose recreational ratings are SDI's. A higher rating's wording contains the lower one's, so it matches the lower claim; a lower never matches a higher.
- **A match certifies the card with no second tap** (H-105), through the ordinary review: `status = verified`, the staffer whose browser ran the check as `reviewedByPersonId`, the agency's matching words as `reviewNote`, and `certifications.agency_checked_at` stamped. The check's own Undo takes all of it back, and takes back only a review a check made, on that diver. Anything short of a match writes nothing and puts the link back beside what the page showed.
- **The app finds the extension by a marker**, `data-diveday-cert-check` on `<html>`, and talks to it with `window.postMessage`, which every browser's extensions share. `src/lib/cert-check-extension.ts` and `extension/protocol.js` are the two copies of the wire format, held together by a test.
- **Scope.** Level cards that are pending or imported-awaiting-confirm. An unsighted self-declaration keeps the sighting form: its agency is often unstated and its number is the diver's typing. Specialty and nitrox cards keep the link. PADI is the next step: it needs a PADI Pro sign-in to build and test against.
- **Settings says whether this browser has it**, in Bookings & waivers, with an "Add to Chrome" link once the Chrome Web Store listing exists (`EXTENSION_STORE_URL`).

## Alternatives considered

- **A server-side scraper.** Rejected: it would be DiveDay's servers hitting the agencies' pages at volume from one address, which is what H-10's "never fetches" stance was against, and it could never use a shop's PADI sign-in.
- **The extension judging the page itself.** Rejected: an extension update ships through store review, so the rule that certifies a card would be the slowest thing to fix and untestable in CI. Words in, verdict on the server, under tests.
- **A staffer's confirm tap on every match.** Aaron chose auto (H-105). The narrow match rule and Undo are what make that safe.
- **Chrome's `externally_connectable`.** Neater, but Chromium only; `postMessage` works in Firefox and Safari too.

## Consequences

- An agency that redesigns its page breaks that agency's check until the extension ships a fix. The check then answers "Couldn't read the page" and the link is still there. CI cannot test against the live pages; the filler and the judge are tested on stand-ins.
- A captcha on an agency's page stops that agency's check the same way.
- Phones never have it: mobile Chrome runs no extensions. It is a front-desk feature.
- "Checked with SSI by <staffer>" is the staffer's attestation that their browser read the agency's page, not proof the agency gave DiveDay: a staffer could post page text by hand, or a script on a DiveDay page could fake the extension's reply. Either reaches no further than Mark certified, with the same permission, and the review names the staffer either way.
- The extension sends the diver's name, birth date and card number to the agency's site, as the staffer did by typing them. Only cards still waiting for a check build a lookup.
- Publishing to the Chrome Web Store needs DiveDay's developer account, a privacy policy and the host-permission justifications: a human step.
- Revisit when an agency offers an API, or if one objects to the lookup.
