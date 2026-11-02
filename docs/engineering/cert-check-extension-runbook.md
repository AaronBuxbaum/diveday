# Cert-check extension runbook

How the DiveDay certification-check extension is validated: what is already proven without anyone
signing in to an agency, the session anyone with Chrome can run against the public lookups, the
session the first pilot shop's PADI Pro runs against DiveChek, how a pilot reports back, the exit
criteria for "beta", and publishing to the Chrome Web Store.

The extension carries words and decides nothing: it fills in the agency's own lookup form in the
staffer's browser and hands the answer's text back, and `judgeAgencyPage`
(`src/lib/agency-check.ts`) decides on the server. Decisions:
[H-20261008-cert-check-extension](../product/human-decisions/H-20261008-cert-check-extension.md) (the extension),
[H-20261008-padi-elearning-check](../product/human-decisions/H-20261008-padi-elearning-check.md) (PADI eLearning),
[H-20261014-padi-divechek](../product/human-decisions/H-20261014-padi-divechek.md) (PADI DiveChek and the beta switch).
Design: [ADR 20261008-cert-check-extension](../architecture/decisions/20261008-cert-check-extension.md).
The code and how to load it unpacked: [extension/README.md](../../extension/README.md). The research
this plan comes from: the no-pro plan of 2026-10-15 (#2259), which found no published PADI clause
against the check and could not read the Pros' Site's own terms.

## Proven without any agency sign-in

Each row is a claim and what holds it. All of them run in CI.

| Claim | Proven by |
| --- | --- |
| The manifest asks only for the agencies' lookup hosts, and its content script runs only on `https://dive.day/shop/*` | `src/lib/cert-check-extension.test.ts` |
| The filler finds each agency's boxes by what they say about themselves, types nothing until every box and the search's own button are found, and presses only that button | `src/lib/cert-check-extension-fill.test.ts` |
| On a signed-in page it refuses a sign-in, sign-up or account address, a password box, an email box that does not search, another host; it answers `signed_out` | `src/lib/cert-check-extension-fill.test.ts`, `e2e/agency-check-extension.spec.ts` (the real extension in a real Chromium, against stand-in agency pages on the agencies' own host names) |
| On DiveChek it hands back only the diver's records, from the line naming them (on one line or over two labeled lines, paired as the judge pairs them) to the line where the judge ends the record, read with the judge's own words (`DIVECHEK_RECORD`, held equal in `extension/protocol.js`), with a gap line between lines that were not neighbors; every other line comes back only as its words saying why or how many | `excerptAroundName` in `src/lib/cert-check-extension-excerpt.test.ts` |
| The judge's rules: name, birth date or number, the agency's own level words, limiting words, one diver on DiveChek, namesakes, transposed dates | `src/lib/agency-check.test.ts`, `src/lib/agency-check-shapes.test.ts` (split names paired top to bottom, a search echoed back, page furniture and search controls, "Jr." as a name suffix, the evidence cut to the record's own words) |
| No match without this diver's record, never beside a second DiveChek diver, no other diver's words or namesake's birth date in the evidence (candidates sharing the first or last name, laid out over labeled lines included), unrelated rows and trailing noise change nothing, the excerpt judges as the page does | `src/lib/agency-check.fuzz.test.ts` (seeded; a failure prints its seed) |
| NAUI, SDI, CMAS and GUE's own page furniture (menus naming levels, notes, footers) never decides a verdict | `src/lib/agency-check.fixtures.test.ts`, fixtures in `src/lib/__fixtures__/agency-pages.ts` |
| A check's Undo takes back only what that check wrote; the other cards a page lists are offered, never certified | `src/lib/agency-check.test.ts`, `e2e/agency-check-listed.spec.ts` |
| "Check all" pauses between cards, skips one unreadable diver, stops at two in a row or at a sign-in | `src/lib/agency-check-queue.test.ts` |
| Both PADI checks are off unless the shop turns on "PADI checks (beta)", and the server refuses a check posted anyway | `src/lib/agency-check-offered.test.ts`, `e2e/agency-check-padi.spec.ts` |
| The page-shape report a failed check sends (logged as `agency_check.page_shape`) carries structure only: labels, button words and headings, no diver's name, nothing typed, no query string, no result line | the report's own unit tests and the real-Chromium e2e |
| The zip holds exactly the files the manifest names (its service worker and the scripts that imports, its content scripts, its icons, and the pages it opens with what they load), never a symlink; a host the extension does not look up, a content script beyond `https://dive.day/shop/*`, a localhost match or a version mismatch is refused | `scripts/pack-extension.test.mjs` |

To run the real-extension e2e locally: `pnpm e2e:build`, then
`pnpm e2e:run e2e/agency-check-extension.spec.ts --reporter=line` with the full Chromium
(`pnpm exec playwright install chromium`; the headless shell cannot load an extension).

## Only a real page can prove

- **PADI DiveChek and eLearning:** the path from the Pros' Site to DiveChek, the boxes' labels, the
  search button's words (PADI's published instructions say "Run Report"), the result's layout (one
  row per card, or one name over several), whether the card number shows, how "Junior" is written,
  the date format a Pro outside the US sees, where a signed-out tab lands, and the Pros' Site terms.
- **Every agency:** the no-result wording (only NAUI's, "No record was found.", has been seen),
  the result's layout, whether a captcha appears, and whether a real match reads as one.
- **SSI:** verify the manual handoff in Chrome: the foreground page has the known name and birth
  date, its authorization checkbox remains untouched, no search is submitted, and the tab remains
  open. The staffer completes the lookup. The extension does not read the result.

## Session 0: the public agencies, by anyone with Chrome

Needs nobody else and no sign-in. Aaron can run it today.

1. Load the extension unpacked ([extension/README.md](../../extension/README.md), "Try it locally"),
   in a browser that is **not** signed in to the PADI Pros' Site.
2. In DiveDay, open Settings, Bookings. The **Card checks** row says "Added to
   this browser (1.5.0)" (or "Not added", or "Update the extension: this browser has …"). Open
   **Try the checks** in that row and press **Run the checks**. Its steps, **Extension**, **Sample lookups**,
   **PADI Pros’ Site** and **Session report**, each say "Passed", "Failed" or "Not in this copy".
   The sample lookups fill the extension's own sample page for each agency with a made-up diver.
   Here, not signed in to PADI, the PADI Pros’ Site step says "Signed out" or "No PADI tab open".
   Each step also asks Chrome whether the extension may go on the agency's own site: a step that
   fails with "Chrome keeps the extension off NAUI’s site…" (or "Not allowed on PADI’s site") means
   site access was withheld in the extension's Details; turn it back on and run again.
3. In the demo shop, on a made-up diver with a pending card at NAUI, SDI, GUE and CMAS in turn,
   press the card's check button ("Check with NAUI", "Search the CMAS portal"). Expected: "no
   record" on each. A page that has moved says "NAUI’s page has changed. Check on its page.": its
   shape is logged as `agency_check.page_shape`, at most 30 a staffer and 120 a shop an hour.
4. Press **Copy report** and paste it into #2259. The report carries versions and each step's
   outcome and reason; the test subject's name, birth date and number are replaced by placeholders
   before it is built.

Expected outcomes: NAUI says "No record was found." (`no_record`); SDI, GUE and CMAS's no-result
wording is unseen, so `unreadable` there means `NO_RECORD_WORDS` needs their words (a test first,
in `src/lib/agency-check.fixtures.test.ts`). A captcha shows as its own reason. A real match needs a
diver with a card at that agency: the pilot shop's staff have those.

## Before the PADI session

- [ ] The extension the pilot installs is at or above DiveDay's minimum version (Settings shows
      it).
- [ ] An owner or manager has turned on **PADI checks (beta)**: Settings, Features.
- [ ] A consenting test subject: Aaron's own PADI card if he has one, or a volunteer's, with a
      pending PADI level card and a birth date on DiveDay. No other diver's record goes on a
      screen-share or into a report.
- [ ] The staffer is a renewed PADI member (DiveChek is a renewed-Pro benefit) and runs everything
      in their own browser. **Nobody shares a PADI sign-in**, with DiveDay or anyone: the license
      is the member's and is not transferable.
- [ ] Session 0 has passed, so a failure in this session is PADI's and not the extension's.

## The PADI session: 30 minutes with the first pilot shop's Pro

A screen-share, or the pilot alone with **Try the checks**: its steps are this session's script.

| Step | Expected | If not |
| --- | --- | --- |
| 1. Extension present and current | Settings: "Added to this browser (1.5.0)"; Try the checks: Extension "Passed" | "Not added" or "Update the extension: this browser has …": reinstall from the store link in Settings |
| 2. A public agency, no record | `no_record` | Session 0 was skipped; run it |
| 3. PADI, signed out | Try the checks: PADI Pros’ Site "Signed out"; a card's check: "Sign in to the PADI Pros’ Site first, then check again." | The page report names the host and path PADI sent the tab to: `SIGN_IN_PATH` in `extension/protocol.js`, or `PADI_ORIGINS` and the manifest's hosts in `extension/agencies.js` |
| 4. PADI, signed in, **dry run** on the test subject's card | "Would mark certified: …" and nothing written | [Reading a report](#reading-a-report) |
| 5. A common name, if the Pro knows one | "PADI lists more than one diver by this name." and nothing certified | [Reading a report](#reading-a-report) |
| 6. The first real check on the test subject, then its Undo | Certified, then back to pending | [Reading a report](#reading-a-report) |
| 7. The same for PADI eLearning on a student whose course is finished | Materials ticked, then Undo | `ELEARNING.padi` in `extension/agencies.js`, `PATTERNS.email` in `fill.js`, `judgeElearningPage` |

Then ask the Pro to open the Pros' Site's terms (its footer or terms link, while signed in) and
paste the text. What to paste back, all into #2259: the session report, the address bar at each
step, and the terms text. **Never a HAR file**: it carries the session's cookies and other divers'
rows.

What to send the pilot shop beforehand (one paragraph, to paste):

Thanks for testing DiveDay’s PADI check with us. It takes about 30 minutes in your own browser, signed in to the PADI Pros’ Site as you normally are; nobody from DiveDay needs your PADI sign-in, ever. Please have one PADI diver who has agreed to be the test subject (a pending PADI card and their birth date on DiveDay), open Settings, Bookings, Certification checks, Try the checks, and press Run the checks. At the end press Copy report and send us what it copies, plus the text of the Pros’ Site terms page. Please do not send a browser network export (HAR): it holds your session and other divers’ details.

## Reading a report

| What it says | What it means | Where the fix goes (test first) |
| --- | --- | --- |
| `fill_failed`, boxes named | A box the lookup needs was not found by its label, name or placeholder | `PATTERNS` in `extension/fill.js`; `cert-check-extension-fill.test.ts` |
| `fill_failed`, no button | The search's own button says something else | `BUTTON_SEARCH` in `extension/fill.js` |
| `signed_out` while signed in | PADI sent the tab to a host or path the extension treats as a sign-in | `PADI_ORIGINS` in `extension/agencies.js`, `SIGN_IN_PATH` in `extension/protocol.js` |
| `captcha`: "SSI is asking if you’re human. Check on its page." | The agency asks for a person on its lookup's own form (a captcha elsewhere on the page stops nothing) | Nothing to fix: the link stays beside the card |
| `page_changed`: "SDI’s page has changed. Check on its page." | The page's boxes are not where they were | The `agency_check.page_shape` log line's shape against the agency's entry in `extension/agencies.js`; past 30 a staffer or 120 a shop an hour a report is dropped unread, so a quiet log is not proof |
| Try the checks: "Chrome keeps the extension off SDI’s site…", or "Not allowed on PADI’s site" | Site access for the agency's host was withheld in the extension's Details | Nothing to fix: turn site access back on |
| `unreadable` on a page that said no | Its no-result words are new | `NO_RECORD_WORDS` in `src/lib/agency-check.ts`, a fixture in `src/lib/__fixtures__/agency-pages.ts` |
| `level_unconfirmed` on a card the page shows | The agency's words for the level differ | `LEVEL_WORDING` in `src/lib/agency-check.ts` |
| `no_record` or `namesake` for a diver the agency holds, after a search with the right name | The birth date was typed in the order the form does not take | `dateFormat` for that agency in `extension/agencies.js` |
| `namesake` on the right diver | The page writes the birth date in the other order | `dates` for that agency in `AGENCY_CHECKS` |
| `limited_card`, the limiting word is the agency's own page text (a note, a footer link, a search control) | The furniture is new | `PAGE_FURNITURE_WORDS` (read at the start of a line) or `SEARCH_CONTROL_LINES` (a whole line) in `src/lib/agency-check.ts`, with a fixture of the page |
| `limited_card`, a trainer's title on a public lookup's record | Designed: whose rating is whose is a person's call | Nothing: leave it |

A wrong verdict is fixed in the judge with the page's own shape as a new case: only the test
subject's lines, never another diver's, in `src/lib/agency-check-shapes.test.ts` or as a fixture.

## After the session: the exits from beta

Paste the terms clause into [H-20261014-padi-divechek](../product/human-decisions/H-20261014-padi-divechek.md). Two exits,
held apart (H-20261014-padi-divechek, confirmed by Aaron Buxbaum on 2026-10-15):

- **"Beta" comes off** only after each of these has been seen on PADI's real pages: a match, a no
  record, a several-divers page, a signed-out page, a Junior (or "Jr.") card, a diver whose name
  ends in "Jr." read as their name and not a Junior card, a PADI Scuba Diver card, and the date
  format of a page read by a Pro outside the US.
- **The default turned on** on 2026-10-23: Aaron Buxbaum made the product owner's call before the
  Pros' Site terms were read (H-20261014-padi-divechek). If the terms rule the check out, `padi` comes out of
  `AGENCY_CHECKS` and `extension/agencies.js`, and a PADI card keeps its "(member sign-in)" link.

PADI has no public API; Dive Shop 360 has a private, PADI-approved integration that makes PADI
certifications searchable. Asking PADI for the same, or for a written OK on this pattern, runs in
parallel and is not waited on.

## Publishing

Chrome Web Store publishing is Aaron's (#2253). What is ready:

- **The listing:** [extension/store/listing.md](../../extension/store/listing.md): name, summary,
  description, single purpose, a justification per permission and host, the data-use answers.
- **The privacy URL:** `https://dive.day/privacy#extension`, the "certification-check extension"
  section of `/privacy`, in English and Spanish.
- **The zip:** `node scripts/pack-extension.mjs` writes `dist/diveday-cert-check-<version>.zip`
  (`--out <dir>` to put it elsewhere). It packs only the files the manifest names and what they load
  (`background.js` and its `importScripts`, the content scripts, the icons, `sample.html` and its
  scripts), and refuses a symlink, a file the manifest names that is missing, a host permission
  for a site the extension does not look up, a content script beyond `https://dive.day/shop/*`
  (`<all_urls>`, `https://*/*` and `file://` included), a localhost or plain-http match, or a
  `manifest.json` version that `protocol.js` does not announce. Edge Add-ons takes the same zip.

Still missing before an upload: the screenshots below. The store's 128×128 icon is
`extension/icons/icon-128.png`, the one `manifest.json` names.

The human steps, in order:

1. Register DiveDay's Chrome Web Store developer account (a one-time fee) under the address that
   should own the listing.
2. Bump `version` in `manifest.json` and `VERSION` in `protocol.js` together, then run the pack
   script.
3. New item, upload the zip, paste each field from the listing, upload the icon and screenshots,
   set visibility to **Unlisted** until
   [the first exit from beta](#after-the-session-the-exits-from-beta), and submit for review.
4. Once published, put the listing's address in `EXTENSION_STORE_URL`
   (`src/lib/cert-check-extension.ts`). Settings then shows "Add to Chrome".

### Store screenshots

The store wants 1280×800 images. They are taken by hand, from the demo shop, whose divers are made
up: no real diver may appear.

1. `pnpm dev`, and load the extension unpacked with `http://localhost/shop/*` added to the content
   script's matches (never published; the pack script refuses it), in a browser that is **not**
   signed in to PADI: the demo shop has PADI checks on.
2. Set the window to 1280×800 (DevTools, device toolbar, Responsive, 1280 × 800, zoom 100%).
3. Capture, with DevTools' "Capture screenshot": Settings, Bookings, saying the
   extension is added; a diver record with a pending SSI card and its "Check with SSI" button; the
   same card after the check, "Marked certified" with its Undo; and the other cards the page lists,
   offered under it.
4. Save them as `extension/store/screenshot-<n>.png` (left out of the zip).

The real-Chromium e2e already drives these surfaces against stand-in agency pages; a scripted
capture can come from it once the guided test page settles.
