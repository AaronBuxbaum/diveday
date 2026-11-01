# UX audit coverage ledger

Audit baseline: `f3bfde4604ea0090eba3143986f01001dbaefab0`. Local synthetic Blue Mantis demo,
2026-10-21. Frozen product clock: `2026-10-21T12:00:00.000Z`. Browser captures use light mode and
reduced motion. Most targeted widths are 390 and 1280 CSS pixels.

## What the coverage means

- **110 page routes inventoried.** Inventory is not proof that each route or state was exercised.
- **47 overview captures** from the broad contact sheet. The runner attempted 121 loads and hit
  redirect/navigation collisions; the image count is not a count of verified routes. Its composite
  is useful for visual consistency, not for proving individual interactions.
- **56 English targeted captures across 27 distinct concrete routes and 29 route/role pairs.**
  Most pairs have phone and desktop evidence; settings and new-diver axe captures add phone-only
  rows. Public pages use anonymous contexts despite the harness's owner filename suffix.
- **Six Spanish captures** across public schedule, reports and branding, each at 390/1280. Cookie
  preference and Accept-Language were set to es-ES. Seeded shop-authored content can remain English.
- **Additional targeted evidence:** the schedule board and settings screenshot helper runs;
  search fault/race probes; draft interruption/control; public booking, fresh readiness, unsigned
  waiver and cancellation. These are separate from the 56-capture count.
- **Six axe samples:** zero violations in the selected rule set. This is not a WCAG certification.
- **One pixel-probe surface:** settings mobile/desktop; two new flags match existing #2848.
- **Four completed specialist passes:** two differently framed dive-domain reviews, one security
  review and one independent design-critic review. Their limits are recorded below.

## Interaction evidence

| Scenario | Outcome | What it does not prove |
| --- | --- | --- |
| Search request returns 503 | Add diver remains highlighted, with no unavailable/retry state (UX-01) | A duplicate record was not created |
| Replace a successful query, hold new response, press Enter | Browser navigates to the previous query's synthetic record (UX-02) | No downstream mutation or authorization bypass was tested |
| Type new-diver name and immediately navigate away | Fresh reopen is blank; no draft action was sent (UX-03) | Other forms/fields and browser-close durability were not exhaustively tested |
| Blur and wait for draft save | Fresh reopen restores the synthetic draft; Start over clears it | Does not cover failed save/discard injection (UX-04 remains source-only) |
| Book a demo Discover Scuba seat | Success leads to readiness; fresh reopen retains normal next-step hierarchy | No Stripe/payment-provider or real email test |
| Open its waiver | Release, ten unanswered medical questions, signature and save-later are present; zero selected radio answers | No medical answers or signature were submitted |
| Cancel that synthetic booking | Inline confirmation succeeds; terminal state says the seat is no longer held | No paid refund or multi-seat cancellation test |
| Render monthly reports | $675 pool and two displayed $338 shares establish UX-08 | No underlying ledger corruption is claimed |
| Measure report text | Ledger amounts/waiver states compute to 14px at 390px (UX-10) | No participant readability test |

All booking and draft mutations used synthetic local data. The booking was canceled through the
normal UI and the saved draft cleared. No production data, real provider settings or external
messages were changed by browser probes.

## Accessibility and visual evidence

Axe used the repository's tags `wcag2a`, `wcag2aa`, `wcag22aa` and its `document-title` exclusion.
No additional axe rule was disabled. Zero violations were returned for public schedule, Today,
Settings, new diver, Reports and manifest at 390px. Incomplete/needs-review rules were not promoted
to passes. No real screen reader, voice control or physical mobile accessibility session was run.

The settings pixel report contained two focus-edge clusters: Today at the left and More at the right
each lose a measured 5px of focus reach. Both match existing #2848. The Today crop is partly
obscured by the development badge, so the conclusion uses the probe geometry and source as well as
the crop. The More crop visibly supports the edge issue. Settled pseudo-element overlay-focus flags
were dismissed for their documented ownership of the ring, not silently counted as passes.

The independent design critic inspected four full-page phone images: fresh readiness, waiver,
reports and Team, plus both named pixel crops. It supported the existing readiness hierarchy, waiver
progression and report ledger. Team composition and the two-minute expectation are research
hypotheses. The possible small-report-text observation was then measured and promoted to UX-10. No
additional celebration was recommended for unfinished states.

Light mode is appropriate to this non-color audit under H-20260925-many-colour-schemes-check. Boat dark mode, high contrast,
landscape, narrow 320px devices, text enlargement and every intermediate responsive breakpoint were
not systematically validated. Selected Spanish screenshots showed the intended translated layout;
they do not certify all strings or their quality.

## Domain and security review scope

The **dock-operator domain pass** reviewed live/offline manifest, crew/print and the proposed
recommendations. It confirmed existing capacity, buddy and unknown-age gaps; identified the stale
serialization premise in #2742; and preserved truthful actual counts, rescue counting and sailed
evidence. No additional safety defect beyond existing issues was established.

The **adversarial-recovery domain pass** reviewed waiver/referral retries, held identities,
capability revalidation, offline expiry, cancellation and move-request lifecycle. It found no unsafe
audit recommendation. Existing tests support the safeguards; the reviewer did not execute a new
concurrency proof. A richer move receipt must remain bound to its current departure and must not
expose staff-private replies or imply a reserved replacement seat.

The **security pass** reviewed draft ownership/expiry/exclusions, search authorization/no-store,
setup operator mail and recap photo actions. No new exploitable vulnerability was established. It
added live-session ownership, clear-on-401, explicit draft allowlists, separate requester receipt
templates and authenticated photo withdrawal constraints. It is not a penetration test.

Early reviewer attempts hit quota; all these passes completed after retry. Their completion does not
imply that every referenced repository test was rerun during this audit. Tests were read as evidence
unless explicitly listed as executed browser probes above.

## Environment and failed-attempt accounting

The locked dependencies were installed. The supported dev server was run with the frozen clock and
its ready marker checked. External HTTP is disabled by the local supervisor, so blank maps or
unavailable provider integrations are not production defect evidence.

The first server/capture attempt became unresponsive after ready and timed out at sign-in. It
produced no valid interaction evidence. After the interruption, the orphaned server was stopped and
a supported server restarted. The broad capture subsequently encountered shared-page navigation
interruptions; targeted checks used fresh contexts to avoid attributing harness collisions to the
application.

Two individual probe attempts used incorrect harness expectations: the first draft click matched a
hidden navigation element, and the first cancellation probe expected a dialog rather than an inline
confirmation. Corrected locators completed both scenarios. Search-failure expectations were revised
to the actual Add diver outcome rather than incorrectly calling it a literal “no matches” message.
These failures are not reported as product defects.

A Next.js auth/prerender warning appeared during local development. Pages rendered after restart;
this audit does not infer production latency or deployment failure from that warning.

## Important remaining gaps

Live payment/refund settlement; real email/SMS/WhatsApp arrival and bounce; OAuth integrations;
large import/export execution; every role/permission combination; live recap sharing; physical
camera/QR flows; real offline sync conflicts; physical iOS/Android feedback; wet/glare use; actual
screen readers; full localization; all empty/large/error states; and production performance.

The source-reviewed bounded-query and failure-path findings have acceptance scenarios for a future
implementation, but were not all seeded and reproduced in the browser. No broad repository unit or
end-to-end suite was run merely to bless a documentation-only audit.

## Targeted render ledger

Status 200 and matching route are recorded below; this proves a render, not all interactions. Public
owner labels are harness metadata only; those contexts were anonymous. Demo trip IDs are ordinary
seeded identifiers, not capability tokens.

| Route | Role | English widths | Spanish widths |
| --- | --- | --- | --- |
| `/find-your-booking` | anonymous | 390, 1280 |  |
| `/s/blue-mantis` | anonymous | 390, 1280 | 390, 1280 |
| `/s/blue-mantis/courses` | anonymous | 390, 1280 |  |
| `/s/blue-mantis/packages` | anonymous | 390, 1280 |  |
| `/s/blue-mantis/trips/cdcb97af-b608-4a81-b4bd-d4748786a246` | anonymous | 390, 1280 |  |
| `/shop/blue-mantis` | captain | 390, 1280 |  |
| `/shop/blue-mantis` | owner | 390, 1280 |  |
| `/shop/blue-mantis/divers/new` | owner | 390 |  |
| `/shop/blue-mantis/inbox` | owner | 390, 1280 |  |
| `/shop/blue-mantis/reports` | owner | 390, 1280 | 390, 1280 |
| `/shop/blue-mantis/requests` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings` | owner | 390 |  |
| `/shop/blue-mantis/settings/billing` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/calendar` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/email` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/export` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/import` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/integrations` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/profile` | owner | 390, 1280 | 390, 1280 |
| `/shop/blue-mantis/settings/rentals` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/security` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/team` | owner | 390, 1280 |  |
| `/shop/blue-mantis/settings/whatsapp` | owner | 390, 1280 |  |
| `/shop/blue-mantis/staffing` | owner | 390, 1280 |  |
| `/shop/blue-mantis/trips/871fd603-ea24-4ae7-a378-6f30b9b9303a/log` | owner | 390, 1280 |  |
| `/shop/blue-mantis/trips/cdcb97af-b608-4a81-b4bd-d4748786a246` | owner | 390, 1280 |  |
| `/shop/blue-mantis/trips/cdcb97af-b608-4a81-b4bd-d4748786a246/manifest` | captain | 390, 1280 |  |
| `/shop/blue-mantis/trips/cdcb97af-b608-4a81-b4bd-d4748786a246/manifest` | owner | 390, 1280 |  |
| `/shop/blue-mantis/trips/cdcb97af-b608-4a81-b4bd-d4748786a246/prep` | owner | 390, 1280 |  |

## Route inventory

- `src/app/about/page.tsx`
- `src/app/claim/[token]/page.tsx`
- `src/app/confirm-contact/[token]/page.tsx`
- `src/app/find-your-booking/page.tsx`
- `src/app/forgot-password/page.tsx`
- `src/app/get-set-up/page.tsx`
- `src/app/get-set-up/sent/page.tsx`
- `src/app/invite/[token]/page.tsx`
- `src/app/offline-manifest/page.tsx`
- `src/app/onboard/page.tsx`
- `src/app/page.tsx`
- `src/app/pricing/page.tsx`
- `src/app/privacy/page.tsx`
- `src/app/product/[feature]/page.tsx`
- `src/app/product/page.tsx`
- `src/app/ready/[token]/forms/page.tsx`
- `src/app/ready/[token]/page.tsx`
- `src/app/recap/[token]/page.tsx`
- `src/app/reset-password/[token]/page.tsx`
- `src/app/s/[shopSlug]/courses/[slug]/page.tsx`
- `src/app/s/[shopSlug]/courses/page.tsx`
- `src/app/s/[shopSlug]/embed/[widget]/page.tsx`
- `src/app/s/[shopSlug]/embed/schedule/page.tsx`
- `src/app/s/[shopSlug]/packages/page.tsx`
- `src/app/s/[shopSlug]/page.tsx`
- `src/app/s/[shopSlug]/register/page.tsx`
- `src/app/s/[shopSlug]/reviews/page.tsx`
- `src/app/s/[shopSlug]/sites/[siteSlug]/page.tsx`
- `src/app/s/[shopSlug]/trips/[id]/embed/page.tsx`
- `src/app/s/[shopSlug]/trips/[id]/page.tsx`
- `src/app/shop/[shopSlug]/boats/page.tsx`
- `src/app/shop/[shopSlug]/bookings/new/[tripId]/page.tsx`
- `src/app/shop/[shopSlug]/bookings/new/page.tsx`
- `src/app/shop/[shopSlug]/courses/[slug]/edit/page.tsx`
- `src/app/shop/[shopSlug]/courses/page.tsx`
- `src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx`
- `src/app/shop/[shopSlug]/dive-sites/new/page.tsx`
- `src/app/shop/[shopSlug]/dive-sites/page.tsx`
- `src/app/shop/[shopSlug]/divers/[personId]/merge/[survivorId]/page.tsx`
- `src/app/shop/[shopSlug]/divers/[personId]/page.tsx`
- `src/app/shop/[shopSlug]/divers/[personId]/waivers/[recordId]/page.tsx`
- `src/app/shop/[shopSlug]/divers/new/page.tsx`
- `src/app/shop/[shopSlug]/divers/page.tsx`
- `src/app/shop/[shopSlug]/gear/[id]/page.tsx`
- `src/app/shop/[shopSlug]/gear/page.tsx`
- `src/app/shop/[shopSlug]/gear/rentals/[ticketId]/page.tsx`
- `src/app/shop/[shopSlug]/gear/rentals/new/page.tsx`
- `src/app/shop/[shopSlug]/gear/work-orders/[workOrderId]/page.tsx`
- `src/app/shop/[shopSlug]/gear/work-orders/[workOrderId]/tag/page.tsx`
- `src/app/shop/[shopSlug]/gear/work-orders/new/page.tsx`
- `src/app/shop/[shopSlug]/gear/work-orders/page.tsx`
- `src/app/shop/[shopSlug]/inbox/page.tsx`
- `src/app/shop/[shopSlug]/lost-found/page.tsx`
- `src/app/shop/[shopSlug]/orders/[id]/page.tsx`
- `src/app/shop/[shopSlug]/orders/[id]/print/dispute/page.tsx`
- `src/app/shop/[shopSlug]/orders/new/page.tsx`
- `src/app/shop/[shopSlug]/orders/page.tsx`
- `src/app/shop/[shopSlug]/page.tsx`
- `src/app/shop/[shopSlug]/print/counter-card/page.tsx`
- `src/app/shop/[shopSlug]/print/page.tsx`
- `src/app/shop/[shopSlug]/print/pass/[bookingId]/page.tsx`
- `src/app/shop/[shopSlug]/promos/packages/page.tsx`
- `src/app/shop/[shopSlug]/promos/page.tsx`
- `src/app/shop/[shopSlug]/reports/page.tsx`
- `src/app/shop/[shopSlug]/requests/page.tsx`
- `src/app/shop/[shopSlug]/reviews/page.tsx`
- `src/app/shop/[shopSlug]/safety-checklist/page.tsx`
- `src/app/shop/[shopSlug]/safety/page.tsx`
- `src/app/shop/[shopSlug]/schedule/blowout/[tripId]/page.tsx`
- `src/app/shop/[shopSlug]/schedule/blowout/day/[date]/page.tsx`
- `src/app/shop/[shopSlug]/schedule/board/page.tsx`
- `src/app/shop/[shopSlug]/schedule/day/[date]/page.tsx`
- `src/app/shop/[shopSlug]/settings/activity/page.tsx`
- `src/app/shop/[shopSlug]/settings/billing/page.tsx`
- `src/app/shop/[shopSlug]/settings/calendar/page.tsx`
- `src/app/shop/[shopSlug]/settings/dock-day/page.tsx`
- `src/app/shop/[shopSlug]/settings/email/page.tsx`
- `src/app/shop/[shopSlug]/settings/embed/page.tsx`
- `src/app/shop/[shopSlug]/settings/emergency-reference/page.tsx`
- `src/app/shop/[shopSlug]/settings/export/backups/page.tsx`
- `src/app/shop/[shopSlug]/settings/export/page.tsx`
- `src/app/shop/[shopSlug]/settings/features/page.tsx`
- `src/app/shop/[shopSlug]/settings/import/page.tsx`
- `src/app/shop/[shopSlug]/settings/integrations/page.tsx`
- `src/app/shop/[shopSlug]/settings/page.tsx`
- `src/app/shop/[shopSlug]/settings/profile/page.tsx`
- `src/app/shop/[shopSlug]/settings/rentals/page.tsx`
- `src/app/shop/[shopSlug]/settings/security/page.tsx`
- `src/app/shop/[shopSlug]/settings/team/page.tsx`
- `src/app/shop/[shopSlug]/settings/whatsapp/page.tsx`
- `src/app/shop/[shopSlug]/staffing/page.tsx`
- `src/app/shop/[shopSlug]/trip-tags/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/incidents/[reportId]/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/log/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/prep/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/prep/ticket/[bookingId]/page.tsx`
- `src/app/shop/[shopSlug]/trips/[id]/print/page.tsx`
- `src/app/shop/[shopSlug]/waivers/page.tsx`
- `src/app/sign-in/page.tsx`
- `src/app/status/page.tsx`
- `src/app/switching/[competitor]/page.tsx`
- `src/app/switching/page.tsx`
- `src/app/switching/spreadsheet/page.tsx`
- `src/app/terms/page.tsx`
- `src/app/unsubscribe/[token]/page.tsx`
- `src/app/verify/[token]/page.tsx`
- `src/app/waivers/[token]/doctor/page.tsx`
- `src/app/waivers/[token]/page.tsx`
