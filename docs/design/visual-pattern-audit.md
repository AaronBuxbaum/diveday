# Visual pattern audit, 2026-10-21

Companion to the [copy consistency audit](visual-consistency-audit.md), issue #2887.
This pass compares equivalent controls and disclosures rather than changing each surface's
composition. The collection editor changes in #2886 are the baseline for this branch.

## Expanded light review

After the initial review below, Aaron requested exploration of every surface and excluded dark
mode. That expanded review is in progress. The initial review's approval applies to its recorded
scope; it does not establish complete runtime coverage.

The expanded inventory distinguishes route patterns from designed states. A route's ordinary
page does not prove that its dialogs, nested disclosures, editors, refusals, account outcomes,
offline reading, or printed document were inspected. Capture assignments derived from source
are preparation; completed captures are matched to their actual rendered paths. Capability paths
are normalized to route patterns in the coverage report.

Additional fixtures exercise real account and consent links, payment and identity editors,
service and staffing controls, initial server-rendered fallbacks, and print pagination. Controlled
Next boundary states render the existing error components and exercise their reset controls;
they establish appearance and reset behavior, rather than the handling of a particular fault.
Security captures remain a one-off audit because session times and recovery codes are dynamic.
Discovery and static checks are recorded separately from browser execution.

### Expanded source inventory

The expanded source census includes the 111 page-route patterns, all 100 locale bundles, and
the opening uses of the app's disclosure and editor primitives. Its 182 primitive references
include native details, automatic disclosures, row menus, modal/dialog bodies, diver-file groups,
certification disclosures, the 11 course/site editor sections, Settings rows, and ledger groups.
Twenty-four ledger groups never fold. Separate manual controllers cover the language and shop
menus, section navigation, week board, manifest menu, and responsive folds. These are source
references, not 182 distinct rendered states or 182 completed captures.

| Surface family | Additional state preparation |
| --- | --- |
| Accounts and capability links | Active, saved, consumed and expired verification/reset/invite links; contact, shore and bookkeeper confirmation; subscription outcomes; short-password and mismatched-password refusals. |
| Staff records and operations | Diver activity/history, booking and card editors, rental fit, private notes, erasure confirmation, work-order line actions, service history, notes and shifts. |
| Departures and preparation | Inner buddy builder, dock rider, snag notes, crew person sheet, course completion/forms, pickup, lunch, emergency contact, private/departure notes, readiness and activity bodies. |
| Payments and requests | Identity ambiguity, order/room-charge editors, provider refusal, promo and date-request details, message composer and sent outcome. |
| Settings and public pages | Security enrollment, refusal, recovery and step-up states; team/course editors; all 21 configured course/site editor sections at both widths; public language picker, course FAQ answers and product capability lists. Pricing FAQ answers are always visible. |
| Exceptional output | Controlled error-component appearance/reset, initial server paint, offline disclosure bodies, claim-tag and privacy-waiver print documents. |

The extra link and payment fixtures use the existing production issuers and writers inside
private demo shops. Both new test endpoints received security review. Before local testing was
curtailed, the payment fixture and shared endpoint guards passed 184 tests. The earlier link
fixture passed its nine focused tests and the then-current shared guard cases; overlapping guard
runs are not added together.

### Approved crash-screen typography

Aaron approved matching the root crash screen's typeface and title style to the other error
screens. Because the global error document replaces the root layout, it now supplies the same
`fontVariables` on its own `html` element. Its heading uses `SHELL_TITLE_CLASS`, the 30px/700
title shared by the other error screens, instead of the previous 24px/600 reading lead.
The existing controlled global-error capture now checks the computed heading size and weight,
Plex font families, font variable and a registered, loaded 700-weight face while preserving its
action-size and reset checks.
These assertions are prepared for later execution; no fresh build, browser capture or rendered
typography measurement was run under the testing hold. The implementation has only source,
focused syntax/formatting and whitespace checks.

### Verification boundary after the testing hold

Aaron subsequently asked running chats to stop local test activity because the computer was
struggling. The audit's production build was terminated, its process tree was reaped, and the
reserved browser window was released. It had not completed compilation. No expanded discovery
browser batch ran, so the newly prepared states, controlled error fallbacks, initial-paint states,
and print documents have no new rendered evidence from this expansion. The earlier contact
sheet and 24-state pixel review remain evidence only for their original scope and source state.

Implementation and lightweight source/syntax checks continue under that instruction. A fresh
build is required before any later browser verification; killed build state is not reused.
Heading punctuation follows Aaron's additional decision that every heading omits its final
period, including a heading that is a complete sentence. It has not received a fresh visual
replay. This expanded review therefore does not claim that every app state has been seen.

Lightweight discovery loaded the registered suite without starting servers or browsers: 463
light-mode test declarations, including 142 in the new registration modules. A test may prepare
more than one capture state. Discovery reported no registration errors. Static route coverage
still names 111 routes with functional specs, 110 with capture assignments, and the documented
security-route exemption; those assignments are not evidence of execution. The locale, E2E
fixture and E2E hygiene source guards pass, as do the workers' focused syntax/format checks and
the final whitespace check. Full lint, typecheck, updated unit tests, build and runtime replay
were not rerun after the testing hold.

Two differently framed domain reviews of the 205-value heading follow-up found no lost words,
conditions, names, ICU arguments, confirmation requirements, or safety qualifications. They
traced safety headings, shared/dynamic consumers and printed labels. Both reviews were source
only. The final copy totals and the distinction between the initial and heading passes are in
the [copy audit](visual-consistency-audit.md#heading-follow-up).

## Coverage and evidence

The source sweep searched the 111 route shapes and their shared UI primitives for inconsistent
control sizes, typography, card and ledger geometry, disclosure affordances, standalone links,
empty states and formatting. The phone contact sheet captured 84 route shapes in 93 page loads
against the local demo shop. A route shape is not every state a route can render.
The production review covers 24 light capture states at 390px and 1280px, including the focused
Got it state: 48 PNGs, with the tiles regenerated from the final captures. These captures do not
cover every account, capability or data state, and this geometry/copy pass does not claim a fresh
dark-mode or print-layout review.

The contact sheet could not discover private capability links, several ID-dependent destinations,
or account lifecycle states from links on visited pages. The internal embedded-schedule path
answered 404 intentionally: the public `?embed=1` URL reaches it through the proxy rewrite.
The new dive-site form's first capture was a transient skeleton; a targeted follow-up succeeded.
The counter card and claim tag are valid print documents without the main-body shape expected by
the contact-sheet readiness guard. Their existing visual-spec captures are the appropriate path.
The capture-tool observation was not filed: the repository helper refused another nonurgent
`needs-triage` issue because the inbox held 42 issues against its ceiling of 40.

Local evidence is under the ignored `screenshots/` directory: `contact-sheet.jpg`,
`walkin-before.png`, `coming-as-before.png`, `cert-check-summary-before.png`, and
`cert-check-summary-after.png`. Production captures and the pixel-probe report are recorded in the
change's final verification rather than implied by this source audit.

## Confirmed families and corrections

| Family | Evidence | Correction |
| --- | --- | --- |
| A text control and action on the same row | At 1280px, the walk-in name input was 48px tall at y=526 with 16px text; Remove was 44px at y=530 with 14px text. The coming-as select was 48px at y=482; Save was 44px at y=486. | Use the standard `md` button beside a text control. Apply the same correction to ask-to-move, tank-fill correction and drysuit-observation recording, which use the same control/button anatomy. |
| A compact disclosure | The Card checks “Try the checks” summary was a 20px line with the browser's filled triangle. The shared compact row renders a 44px target and the app's outlined caret. | Use `CompactDisclosureRow` for that nested settings disclosure, earlier cards to process, the course ladder's person list and adding a customer's gear piece. Preserve native details, outcome-open state, submitted fields and action handlers. |
| The booking email correction | The correction was a hand-written 12px button in a field description without the shared target floor. | Use the shared link-button treatment with a 44px target. The suggestion still waits for blur and changes the address only when pressed. |
| Standalone review and verification actions | The real imported-payment journey measured its report review link at 20px. Pending SSI verification measured 20px in both phone and desktop browser tests; the same live component used that treatment for the extension action. | Use the canonical 44px link target for the report door and shared link-button sizing for verification links and buttons. URLs, card checks and pending behavior remain. |
| The work-order customer's chooser link | The probe measured “Choose somebody else” at 147×18px on a phone. The existing work-order journey failed its new target-size assertion at 18px. | Use the canonical 44px text-link target while retaining the original customer-search destination. |
| Course schedule times | The Open Water schedule rendered its three time ranges at 14px with 20px line height. Browser regressions failed at both viewport widths. | Use the established 16px floor for critical times. Supporting course-day descriptions keep their smaller size. |

`e2e/visual-consistency.spec.ts` checks actual rendered geometry at 390px and 1280px, removes an
added walk-in row, opens the card-check disclosure by keyboard, and applies an email correction
only on intent. It also checks course-time legibility and the agency link's transition to an
extension action. The existing payment-history import journey checks the report review target
and its original destination. Existing visual captures cover the walk-in rows, public course
schedule and card-check disclosure; added states cover the coming-as editor, booking email
correction, agency link/action and imported-history report. Geometry is not asserted through
class-name unit tests.

The original add-piece fragment target was on the summary; the shared row puts it on details.
An isolated Chromium hard-navigation reproduction tested both shapes and a label-span target.
All three left the details closed and its input hidden, so a proposed fragment-reveal regression
was not reproduced. The form still opens when its own submission returns an outcome.

## First formal review and repairs

The first formal light-mode review read 21 captures and 126 probe records: zero skipped,
16 flags in nine clusters. The confirmed findings below have source repairs; subsequent captures
were reviewed in the second and final formal round described below.

- **Agency credentials and actions:** the new inline target had joined the credential number
  and check action into one run. A structural wrapper restores the action's own row while
  retaining its 44px target, destination and extension behavior.
- **Empty header action slots:** a deleted diver no longer renders an empty booking-action
  wrapper. The manifest action host now follows its menu's responsive visibility, removing the
  empty desktop gap tracked in #2885 while preserving the phone header and desktop footer
  emergency-reference doors.
- **CatchUpStrip hover:** Got it uses the flush link treatment instead of a filled hover corner
  nested too closely inside the strip's corner; its target, inset, focus and dismiss action remain.
- **Settings disclosure:** the redundant frame around Try the checks is removed, leaving the
  shared compact disclosure to express the existing hierarchy and avoiding nested hover corners.
- **Departure-log passenger figure:** the Spanish mixed-passenger summary clipped its rider
  qualifier at both 390px and 1280px. The existing passenger total is now the numeric figure,
  with the complete localized breakdown in the statistic's detail line; crew remains separate.
  The added Spanish capture checks the rendered figure and full detail at both widths.

The review dismissed C1–C3 as the already intentional clipped leading separator in ConditionsLine
and its transparent ancestors, rather than a visible content-column offset. C5's status icons
belong to different semantic depths rather than one repeated column. These explanations are
recorded in [settled questions](settled-questions.md); empty slots, small targets and nested filled
corners received no exemption. The [holistic assessment](surfaces.md#visual-consistency-audit-2026-10-21)
preserves the existing surface compositions.

## Second and final formal review corrections

The final formal round reviewed the initial 23 light capture pairs and bounded its remaining
findings to three corrections. Their source fixes, final corrective production replay and
captures are complete; the second and final formal review approved the result within the
reviewed scope, with no outstanding design findings.

- **Got it centering:** the corrected link target still put its label about 6.7px right of its
  own centre. It now uses the canonical link/bare `flush: "padded"` mode, with symmetric 8px
  target room and an 8px outdent preserving the panel's text inset. The unpainted hover remains;
  no guard bypass, centering exemption or label override is used.
- **CourseLadder paragraph punctuation:** complete English and Spanish explanatory paragraphs
  now end with periods, including their resolved ICU branches, following the approved sentence
  convention without changing their conditions or qualifiers.
- **EmptySeats record links:** primary trip links use 16px text while supporting seat counts
  remain 14px. The canonical target stays at least 44px and the single-line ledger row keeps its
  52px floor, with the existing trip destinations and room to wrap.

## Intentional differences

Separate compact action rows retain `sm` buttons, including the walk-in Add another person action,
the separate Change anyway form and the clear-observation action. Their controls do not share a
row with a 48px text field. Offline roll-call badges keep their recorded safety-specific weight
and borders. The logbook postcard's visit mark remains part of its illustration vocabulary.
Settings navigation carets and expand carets keep different directions. The existing settled
questions continue to explain stretched row-link focus, wrapping readiness facts and ledger rules.

The `ShopStat` optional link branch has no consumer anywhere in `src/`, so it produces no current
UI inconsistency. The no-check fallback in `AgencyCheckLink` is likewise unused by current
callers, but now shares the same canonical link-button sizing as its live `AgencyCheck` path.
The postcard visit-count exception is also recorded in [settled questions](settled-questions.md).

The course ladder's person disclosure and earlier-card processing disclosure are not populated
by the ordinary demo seed. The supplemental visual test uses the existing certified-recap
fixture: it issues a real shop card through the established writer, populating the processing
queue and next-course cohort without a new seed API. Closed and opened captures exercise both
disclosures. Two other supplemental tests build tank-gas correction and drysuit-observation
forms through the ordinary rental and diver-fit UI. These supplemental captures are included in
the final local verification below.

## Initial audit verification before the expanded review

Seven focused component files passed 54 tests: booking party fields, coming-as, walk-in party
rows, tank-gas presentation, cards-to-process, agency checking and public course sections.
The initial eight browser geometry/interaction cases passed against the first production build.
The additional course, agency and imported-report assertions reproduced defects before correction
(14px times and 20px links); later runs passed thirteen checks. The work-order chooser's added
assertion also reproduced its 18px target before correction.

Completed local evidence across the subsequent runs includes:

- Four focused probe suites passed 121 tests, preserving generic thresholds and checks for an
  unrelated visible stray instead of broadly settling alignment failures.
- The fourteen-case geometry run passed before the last corrective source edits; five critical
  smoke journeys, the payment-history import journey and the work-order journey also passed
  across the previous runs, alongside sixteen visual capture groups.
- The initial [copy audit](visual-consistency-audit.md) records 641 changed message values across
  355 keys in 73 locale files; its final focused run passed 835 tests in 54 files.

At that checkpoint, the final production build, full typecheck and repository checks passed.
Lint passed with its 19 baseline warnings. The final bounded browser replay passed all seven cases,
including centred CatchUpStrip targets at 390px and 1280px, the import report's 16px trip links
and 44px targets, waiver smoke, and manifest, course, report and focused Got it captures. This replay
closes the families changed after the earlier passing runs; their unchanged families retain
their earlier evidence.

The checkpoint's pixel-probe report contains 144 records, zero skipped, 24 capture states, zero open
flags and seven settled clusters. The known atlas identity limitation was addressed for this
review with explicit Got it focus PNGs rather than a change to the atlas tool. The final critic
verified the normal and focused Got it label, focus ring and panel clearance at both widths,
the report's 16px trip titles and the course paragraph periods. Its approval and specific
verdicts for all seven settled clusters are recorded in `/tmp/diveday-3392-design-final.md`;
the six earlier Got it centering flags were repaired rather than exempted.

The changed-file run passed 481 tests in 21 files; guards passed 84 tests in 24 files; the
primitive/component run passed 59 tests in three files. These runs overlap the 835 copy-related
tests and 121 probe tests above and are not summed into a purported distinct-test total.
Local integration logs are `/tmp/diveday-3392-build-final-verified.log`,
`/tmp/diveday-3392-lint-final-verified.log`, `/tmp/diveday-3392-catchup-compile-typecheck.log`,
`/tmp/diveday-3392-repo-final-verified.log` and `/tmp/diveday-3392-final-replay.log`.
No permission, readiness, gas, certification or medical rule changed in this presentation pass.

## Publication integration checkpoint

The publication parent is now operational UX [#2906](https://github.com/AaronBuxbaum/diveday/pull/2906),
branch `codex/ux-operational-trust-20261021`, at `ba639b0a3efb494db837b1629b4b0aab11a14794`.
Its hosted CI run 5034 completed successfully. Aaron asked all chats to push their saved work and
respond to hosted CI failures, while retaining the restriction against heavy local testing.

The audit is being integrated with that exact parent using source, JSON, syntax, formatting and
whitespace checks. The inherited migrations and export snapshot remain the parent's work; this
presentation audit adds no schema change. The initial validation above belongs to its recorded
pre-integration checkpoint. No fresh local build, browser replay, full typecheck or broad test
gate establishes the final integrated head. Expanded capture preparation still does not establish
that every designed state has been rendered or reviewed.

The integrated JSON diff against that parent changes 847 message values across 454 keys in 79
locale files: 452 English and 395 Spanish values. No message keys are added or removed, and the
incoming collection/editor wording remains. The earlier 846-value count is the historical
pre-integration checkpoint. One additional English buddy-team warning fragment loses its terminal
period; every safety qualification remains, and its complete Spanish body sentence keeps its
period. The [copy audit](visual-consistency-audit.md#heading-follow-up) records both checkpoints.

The root thread owns the integration commit, push, draft PR and hosted CI handoff. Publication and
the audit's own final-head CI result are not claimed by this source checkpoint.
