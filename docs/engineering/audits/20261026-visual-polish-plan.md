# Visual polish execution record — 26 October 2026

Portable record of 85 stable proposals from the 25 October visual review. This document preserves
the audit scope and owner-approved implementation direction so a GitHub issue can be understood
without the local screenshot folder. It is an execution snapshot, not a second feature backlog or
proof that work has shipped.

Audit commit: `1419edbd6cb2ab218b6f9a97ca1c0db387cca2f0`. Source comparison:
`d75f4dea7b51e1e2d57c597dc0b0f56449049c6b`; the relevant source paths were unchanged at that
comparison. Later implementation work must be verified at its own head.

Owner outcome: 71 proposals ready, 4 requiring focused verification, 7 already done, and 3 retaining
current behavior (M04, D06, D07). All eight additional owner approvals are recorded below. M02 adds
no new Product hero scene; RGS04 adds no filename search. No owner questions remain pending. Any
browser review Skip and notes retain precedence; browser-only choices were not read.

Current execution targets cover all 75 residual proposals (71 ready and 4 requiring verification).
Issue #3066 is in progress; the six later batches are queued. The 7 already-done and 3
owner-retained proposals have no new execution target.

| Execution issue | Proposal IDs | State |
| --- | --- | --- |
| [#3066](https://github.com/AaronBuxbaum/diveday/issues/3066) | C01, C06, C13, C14, D05, B05, RB09, RGS01 | In progress |
| [#3069](https://github.com/AaronBuxbaum/diveday/issues/3069) | M01, M02, M03, M05, M06, M09, D01, D02, D03, D04, RP01, RP08, D08 | Queued |
| [#3070](https://github.com/AaronBuxbaum/diveday/issues/3070) | M07, M08, RP05, C03, C05, C07, C08, C09, C11, C12, RGS02, RGS04, RGS09 | Queued |
| [#3071](https://github.com/AaronBuxbaum/diveday/issues/3071) | S01, S02, S03, S04, S05, S06, S07, S08, S09, RR03, RR04, RR05, RR08 | Queued |
| [#3072](https://github.com/AaronBuxbaum/diveday/issues/3072) | C04, C10, RGS03, RGS06, RGS07, RGS08, RR02, RR06, RR07, RR09 | Queued |
| [#3073](https://github.com/AaronBuxbaum/diveday/issues/3073) | B01, B02, B03, B04, B07, B08, RB02, RB03, RB04, RB05, RB06, RB08, RP09 | Queued |
| [#3074](https://github.com/AaronBuxbaum/diveday/issues/3074) | R01, RP02, RP03, RP04, RP06 | Queued |

Prerequisite [issue #3065](https://github.com/AaronBuxbaum/diveday/issues/3065) is tracked in [PR
#3067](https://github.com/AaronBuxbaum/diveday/pull/3067), on `codex/visual-polish-01-feedback`
after [PR #3054](https://github.com/AaronBuxbaum/diveday/pull/3054). The implementing chat reports
the local quick gate passed; hosted CI remains pending. Comparison with the actual intended base
shows four files; the stale registered PR base pin remains under investigation. These statuses do
not claim merge or deployment.

The latest portable mapping is prepared on `codex/visual-polish-02-clear-controls`. [Open this
branch’s portable
record](https://github.com/AaronBuxbaum/diveday/blob/codex/visual-polish-02-clear-controls/docs/engineering/audits/20261026-visual-polish-plan.md).
Proposal links in the local artifact point to these lowercase GitHub headings; the update becomes
available after this branch is pushed.

Local interactive artifact ID: `01a16de7-0368-77e2-b15c-7d6e84a71f38`. Its folder contains
`index.html`, `review-data.json`, `execution-ledger.json` and `implementation-plan.md`. Local links
use `index.html#C01`; this document uses the GitHub heading anchor `#c01`. The committed document is
the portable GitHub context; original screenshot files remain in the local artifact. The large ZIP
was not rebuilt.

Existing issue/PR search was verified 26 October: all open records and records updated since 1
October were searched. Closed records unchanged since 1 October were not exhaustively searched.
Exact execution tickets, partial matches and historical context are distinguished below; related
issues are not automatic closure targets.

Verification boundary: no new browser interaction, keyboard/touch checks, computed styles,
accessibility/provider/payment checks or A4/Letter PDF pagination was performed for this record.
Follow current repository review and CI rules. Safety-critical changes require two differently
framed domain reviews; security-sensitive changes require security review. Audit status and
execution readiness are independent.

## Proposal index

**Marketing**: [M01](#m01), [M02](#m02), [M03](#m03), [M04](#m04), [M05](#m05), [M06](#m06),
[M07](#m07), [M08](#m08), [M09](#m09), [RP07](#rp07), [RP08](#rp08)

**Public booking**: [D01](#d01), [D02](#d02), [D03](#d03), [D04](#d04), [D05](#d05), [D06](#d06),
[D07](#d07), [D08](#d08)

**Staff workspace**: [S01](#s01), [S02](#s02), [S03](#s03), [S04](#s04), [S05](#s05), [S06](#s06),
[S07](#s07), [S08](#s08), [S09](#s09)

**Boat & preparation**: [B01](#b01), [B02](#b02), [B03](#b03), [B04](#b04), [B05](#b05),
[B06](#b06), [B07](#b07), [B08](#b08)

**Settings**: [C01](#c01), [C02](#c02), [C03](#c03), [C04](#c04), [C05](#c05), [C06](#c06),
[C07](#c07), [C08](#c08), [C09](#c09), [C10](#c10), [C11](#c11), [C12](#c12), [C13](#c13),
[C14](#c14), [C15](#c15)

**Preparation links**: [R01](#r01)

**Boat operations**: [RB01](#rb01), [RB02](#rb02), [RB03](#rb03), [RB04](#rb04), [RB05](#rb05),
[RB06](#rb06), [RB07](#rb07), [RB08](#rb08), [RB09](#rb09)

**Records & commerce**: [RR01](#rr01), [RR02](#rr02), [RR03](#rr03), [RR04](#rr04), [RR05](#rr05),
[RR06](#rr06), [RR07](#rr07), [RR08](#rr08), [RR09](#rr09)

**Configuration**: [RGS01](#rgs01), [RGS02](#rgs02), [RGS03](#rgs03), [RGS04](#rgs04),
[RGS06](#rgs06), [RGS07](#rgs07), [RGS08](#rgs08), [RGS09](#rgs09)

**Diver journeys**: [RP01](#rp01), [RP02](#rp02), [RP03](#rp03), [RP04](#rp04), [RP06](#rp06)

**Authentication**: [RP05](#rp05)

**Messaging**: [RP09](#rp09)

## M01

**Make the homepage a short, persuasive journey**

**Execution:** Ready to implement. Owner explicitly approved: Move repeated catalogue to Product;
preserve all essential booking-to-boat scenes. Homepage editorial replacement changes the settled
H-93 booking-to-boat argument; preserve required dock check-in scene, and do not reduce five scenes
to three without deciding which.

**Owner decision:** Move repeated catalogue to Product; preserve all essential booking-to-boat
scenes.

**Audit assessment (25 October):** partially-resolved. The current phone homepage is 10,444px tall,
down from the prior 11,326px. Duplicate import preview, closing copy and terms were reduced, but
five journey scenes and the feature catalogue remain. The larger editorial proposal is still open.

**Remaining observation:** The current phone homepage is 10,444px tall, down from the prior
11,326px. Duplicate import preview, closing copy and terms were reduced, but five journey scenes and
the feature catalogue remain. The larger editorial proposal is still open.

**Audit direction:** Keep a compact promise, one convincing product scene, three essential moments,
migration reassurance, price and demo action. Move the full capability inventory to Product. This is
an editorial redesign, not a request to shrink every section. Preserve the settled fourth homepage
dock check-in scene (H-94).

**Acceptance:**

- Compare complete before/after phone and desktop pages
- A visitor can identify audience, core workflow, price and next step without reading twelve
  features
- Retain accurate migration and pricing qualifications

**Source:** src/app/page.tsx; src/app/product/; marketing components and bundles

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes M01; queued for implementation or required verification.

- Historical/context: [PR #2109](https://github.com/AaronBuxbaum/diveday/pull/2109) — closed,
partial. Earlier homepage journey redesign; refined editorial reduction remains.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
partial. Removed duplicate marketing copy and mocks.

- Historical/context: [PR #3061](https://github.com/AaronBuxbaum/diveday/pull/3061) — closed,
related. Implements H-94 fourth dock check-in scene, which must be preserved.

**Evidence references in local artifact:** `current/landing-light-vw-390.png`,
`current/landing-light-vw-1280.png`

## M02

**Show the product sooner in marketing heroes**

**Execution:** Ready to implement. Shorten existing hero text and bring the existing homepage scene
nearer the promise; Product can shorten text now. Adding a new Product hero scene is separate
decision scope.

**Owner decision:** Omit new Product hero scene; shorten/reposition existing material only.

**Audit assessment (25 October):** still-open. The current 390px homepage first viewport still ends
among the CTA qualifiers before product imagery. Product has a text-led directory hero and no
product scene in its first viewport. Desktop home already puts a legible roll-call scene beside the
promise.

**Remaining observation:** The current 390px homepage first viewport still ends among the CTA
qualifiers before product imagery. Product has a text-led directory hero and no product scene in its
first viewport. Desktop home already puts a legible roll-call scene beside the promise.

**Audit direction:** Compose a shorter hero with one demo action, a quiet secondary link and a small
legible product scene close to the promise. Keep detailed supporting proof below.

**Acceptance:**

- 390px, 768px and desktop hero captures
- Product scene remains readable rather than becoming a decorative postage stamp
- Demo remains the primary conversion route

**Preserve/review:** Do not change CTA strategy to unapproved self-service signup.

**Source:** src/app/page.tsx; src/app/product/

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes M02; queued for implementation or required verification.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
related. Marketing consistency cleanup, not short hero/product-scene composition.

**Evidence references in local artifact:** `current/landing-light-vw-390.png`,
`current/landing-light-vw-1280.png`

## M03

**Reduce mobile marketing navigation to one calm row**

**Execution:** Ready to implement. Owner explicitly approved: Use one-row mobile navigation with
secondary Menu. Replacing visible navigation with a new mobile menu introduces an interaction and
changes which destinations stay visible.

**Owner decision:** Use one-row mobile navigation with secondary Menu.

**Audit assessment (25 October):** still-open. Current phone marketing header still occupies two
rows, with brand/demo above five navigation links. Signed-in and compact setup variants differ
deliberately.

**Remaining observation:** Current phone marketing header still occupies two rows, with brand/demo
above five navigation links. Signed-in and compact setup variants differ deliberately.

**Audit direction:** Keep brand and one contextual action in a compact header; put secondary
destinations in an accessible menu. Retain visible Sign in for returning staff where space permits.

**Acceptance:**

- Menu keyboard focus, Escape and focus return
- Long translated labels and 200% zoom
- Public marketing and signed-in marketing states

**Preserve/review:** Do not hide the only demo route; avoid adding another sticky action bar.

**Source:** Marketing header/navigation components

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes M03; queued for implementation or required verification.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
related. Shared marketing cleanup, not accessible compact mobile navigation.

**Evidence references in local artifact:** `current/landing-light-vw-390.png`,
`current/landing-light-vw-1280.png`

## M04

**Lead About with purpose, then the personal story**

**Execution:** Retain current by owner choice. Owner explicitly chose to retain current behavior:
Keep current About opening.

**Owner decision:** Keep current About opening.

**Audit assessment (25 October):** still-open. About still opens its first phone screen with the
extended Lonergan account. This remains an owner editorial choice; no new purpose-first opening was
implemented.

**Remaining observation:** About still opens its first phone screen with the extended Lonergan
account. This remains an owner editorial choice; no new purpose-first opening was implemented.

**Audit direction:** Open with a brief statement of who DiveDay serves and what it helps protect.
Keep the personal account in a clearly titled, restrained section with enough context to understand
the motivation.

**Acceptance:**

- Owner approves tone and factual accuracy
- Purpose visible in first phone screen
- Story remains respectful and does not become conversion pressure

**Preserve/review:** Editorial choice for Aaron; do not rewrite personal history or imply the
software guarantees safety.

**Source:** src/app/about/page.tsx and copy bundle

**GitHub match:** missing-equivalent. No exact equivalent in all open records or recently updated
closed records; related items are context only.

- Historical/context: [PR #2165](https://github.com/AaronBuxbaum/diveday/pull/2165) — closed,
related. H-99 explicitly keeps Lonergan hero and company voice; respect settled copy constraints.

- Historical/context: [PR #2113](https://github.com/AaronBuxbaum/diveday/pull/2113) — closed,
related. Earlier story-first About redesign, not proposed purpose-first composition.

**Evidence references in local artifact:** `current/about-light-vw-390.png`,
`current/about-light-vw-1280.png`

## M05

**Give the switching hub an outcome-led headline**

**Execution:** Ready to implement. Outcome-led heading is routine copy cleanup under settled H-93,
with migration limits intact.

**Audit assessment (25 October):** still-open. The current switching hub still leads with “Every
guide ends at the same import screen”. Its close is calmer, but the outcome-led headline proposal
remains.

**Remaining observation:** The current switching hub still leads with “Every guide ends at the same
import screen”. Its close is calmer, but the outcome-led headline proposal remains.

**Audit direction:** Try “Bring your shop with you” with a short line about what moves, what stays
behind and how to start; retain the specific guides and honest migration limitations.

**Acceptance:**

- Headline and guide choices visible together on phone
- No promise that unsupported records migrate

**Source:** src/app/switching/page.tsx and marketing bundle

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes M05; queued for implementation or required verification.

- Historical/context: [PR #3059](https://github.com/AaronBuxbaum/diveday/pull/3059) — closed,
partial. Merged duplicate switching close; headline still separate scope.

**Evidence references in local artifact:** `current/switching-hub-light-vw-390.png`,
`current/switching-hub-light-vw-1280.png`

## M06

**Split the online-booking headline into one claim and one reassurance**

**Execution:** Ready to implement. Split compound claims into headline and supporting sentence;
retain admission-versus-boarding precision. No new product promise.

**Audit assessment (25 October):** still-open. Online booking still combines the convenience and
certification clauses in a six-line 390px heading. Courses, Check-in and Dive sites retain similarly
long compound headings.

**Remaining observation:** Online booking still combines the convenience and certification clauses
in a six-line 390px heading. Courses, Check-in and Dive sites retain similarly long compound
headings.

**Audit direction:** Lead with “Divers book while you’re out on the water”; move the certification
requirement explanation into a short supporting sentence. Scope from current CI review: Inspect the
same multi-clause headline pattern on Courses, Check-in and Dive sites feature pages. Preserve
concrete safety/operational promises in supporting text.

**Acceptance:**

- 390px and desktop line breaks
- Copy distinguishes seeing requirements from verified certification

**Preserve/review:** Never imply checkout verification equals boarding clearance.

**Source:** src/app/product/[feature]/ and feature copy

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes M06; queued for implementation or required verification.

- Historical/context: [PR #2103](https://github.com/AaronBuxbaum/diveday/pull/2103) — closed,
related. Introduced feature page copy; no refined headline split acceptance criteria.

**Evidence references in local artifact:** `current/feature-online-booking-light-vw-390.png`,
`current/feature-online-booking-light-vw-1280.png`

## M07

**Give authentication a quiet shell**

**Execution:** Ready to implement. Reuse the existing quiet auth shell for generic sign-in/recovery.
This is wrapper consistency, not an authentication behavior change.

**Audit assessment (25 October):** still-open. Generic sign-in and forgot-password still carry
marketing navigation, demo action and footer. Required-field markers were removed on sign-in, but
its shell is unchanged. Active invitation/reset states already retain their quiet shell.

**Remaining observation:** Generic sign-in and forgot-password still carry marketing navigation,
demo action and footer. Required-field markers were removed on sign-in, but its shell is unchanged.
Active invitation/reset states already retain their quiet shell.

**Audit direction:** Use brand/back-home, the form, recovery and setup/help links. Keep necessary
legal access quiet. Apply the same shell to recovery and reset states. Scope from current CI review:
Active invite/reset screens already use a quiet shell. Apply only to noisy generic
sign-in/forgot-password wrappers, not every auth route.

**Acceptance:**

- Sign-in, forgot-password, reset success/error
- Password manager and redirect behavior unchanged
- Keyboard focus and field errors

**Source:** src/app/sign-in/; src/app/forgot-password/; auth layout

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes M07; queued for implementation or required verification.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
partial. Tidied sign-in/dead links; noisy generic wrappers remain in audit.

**Evidence references in local artifact:** `current/sign-in-light-vw-390.png`,
`current/sign-in-light-vw-1280.png`

## M08

**Remove the extra setup landing step**

**Execution:** Ready to implement. Remove redundant closed/consumed/uninvited setup interstitial
only; authorized onboarding and its inputs remain intact.

**Audit assessment (25 October):** still-open. Closed and consumed onboarding still show an
intermediate explanation and Get set up action. Active authorized onboarding remains a distinct
legitimate form.

**Remaining observation:** Closed and consumed onboarding still show an intermediate explanation and
Get set up action. Active authorized onboarding remains a distinct legitimate form.

**Audit direction:** Simplify only closed, consumed or uninvited entry paths to one appropriate
setup destination with a brief human-setup expectation. Preserve active authorized onboarding and
its required inputs.

**Acceptance:**

- Entry from marketing and auth
- Submitted and error states retain clear next step
- No loss of existing deep links

**Source:** src/app/onboard/; src/app/get-set-up/

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #1961](https://github.com/AaronBuxbaum/diveday/issues/1961) — closed,
related. Setup-invite policy and token security, not uninvited/consumed entry simplification.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes M08; queued for implementation or required verification.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
related. Setup-success and token page cleanup.

**Evidence references in local artifact:** `current/onboard-closed-light-vw-390.png`,
`current/onboard-closed-light-vw-1280.png`

## M09

**Ask the minimum before an owner can request setup**

**Execution:** Ready to implement. Owner explicitly approved: Make Current tool optional. Required
current-tool information is a business intake policy. Compact existing selection is safe, but
optionality needs owner answer.

**Owner decision:** Make Current tool optional.

**Audit assessment (25 October):** still-open. Current-tool selection still occupies five full-width
choices before name/email, with a second provider list when selected. The form remains 1,405px tall
before provider expansion. Required-information policy remains an owner choice.

**Remaining observation:** Current-tool selection still occupies five full-width choices before
name/email, with a second provider list when selected. The form remains 1,405px tall before provider
expansion. Required-information policy remains an owner choice.

**Audit direction:** Lead with contact/shop details; make current-tool selection compact and place
it where it supports migration routing. Decide explicitly whether it must be required.

**Acceptance:**

- Phone keyboard viewport
- No-tool and other-tool paths
- Validation keeps entered data

**Preserve/review:** Owner decision on required information; do not silently remove business
requirements.

**Source:** src/app/get-set-up/

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2834](https://github.com/AaronBuxbaum/diveday/issues/2834) — closed,
related. Setup-mail security; not minimum setup-request form scope.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes M09; queued for implementation or required verification.

**Evidence references in local artifact:** `current/get-set-up-light-vw-390.png`,
`current/get-set-up-light-vw-1280.png`

## D01

**Let a shopfront answer “When can I dive?” sooner**

**Execution:** Ready to implement. Owner explicitly approved: Put dates/schedule before storefront
introduction. Moving the entire schedule ahead of shop story/gallery changes storefront information
architecture, beyond deleting repeated logo/filter chrome already shipped.

**Owner decision:** Put dates/schedule before storefront introduction.

**Audit assessment (25 October):** partially-resolved. The separate hero logo tile is gone and
schedule controls are consolidated. The current phone shopfront is 6,891px tall;
identity/intro/badges/gallery still precede the schedule. The standard schedule capture has no
next-trip card because its fixture is not the old live state; preserve the conditional next-trip
card already in source rather than requesting another.

**Remaining observation:** The separate hero logo tile is gone and schedule controls are
consolidated. The current phone shopfront is 6,891px tall; identity/intro/badges/gallery still
precede the schedule. The standard schedule capture has no next-trip card because its fixture is not
the old live state; preserve the conditional next-trip card already in source rather than requesting
another.

**Audit direction:** Keep the logo in navigation and consolidated filters. Explore earlier access to
full schedule/date choices while preserving the conditional next-trip card and supporting shop
story.

**Acceptance:**

- Full phone and desktop shopfront
- Next departure discoverable without traversing a full brand story
- No trips and courses-only shops

**Source:** src/app/s/[shopSlug]/page.tsx and shopfront components

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes D01; queued for implementation or required verification.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
partial. Logo and filter consolidation implemented; earlier full schedule access remains.

**Evidence references in local artifact:** `current/schedule-light-vw-390.png`,
`current/schedule-light-vw-1280.png`

## D02

**Make “Find my booking” easy to find**

**Execution:** Ready to implement. Expose existing recovery destination through shared
PublicShopNav; no new recovery mechanism or privacy policy.

**Audit assessment (25 October):** still-open. Find my booking remains in Other ways we can help
after departures, courses, boats and reviews. A global homepage recovery link now exists, but does
not resolve recovery discoverability on a shopfront.

**Remaining observation:** Find my booking remains in Other ways we can help after departures,
courses, boats and reviews. A global homepage recovery link now exists, but does not resolve
recovery discoverability on a shopfront.

**Audit direction:** Add a quiet Find my booking link near shop navigation or schedule identity,
retaining the existing recovery flow and privacy behavior.

**Acceptance:**

- First-time visitor still sees booking as primary
- Returning diver can find recovery without scrolling through all departures
- No disclosure of booking existence

**Preserve/review:** Do not weaken privacy-preserving recovery responses.

**Source:** src/app/s/[shopSlug]/; src/app/find-your-booking/

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2690](https://github.com/AaronBuxbaum/diveday/issues/2690) — closed,
related. Find-your-booking capture determinism, not a public navigation door.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes D02; queued for implementation or required verification.

**Evidence references in local artifact:** `current/find-my-booking-composer-light-vw-390.png`,
`current/find-my-booking-composer-light-vw-1280.png`

## D03

**Keep alternative trips after the selected trip’s booking action**

**Execution:** Ready to implement. Reorder existing mobile sections so selected-trip booking
precedes alternatives; preserve desktop ordering and all terms.

**Audit assessment (25 October):** still-open. On current phone trip pages, Also on the schedule
still precedes Grab a seat. The sticky Book action offers a direct jump, and desktop correctly keeps
the form beside trip facts.

**Remaining observation:** On current phone trip pages, Also on the schedule still precedes Grab a
seat. The sticky Book action offers a direct jump, and desktop correctly keeps the form beside trip
facts.

**Audit direction:** Place the selected departure’s form immediately after essential trip facts and
requirements. Put alternatives below it; when full or unavailable, promote alternatives at the
unavailable state. Scope from current CI review: Confirmed phone composition concern; desktop
already places booking beside trip information. Avoid moving useful desktop alternatives
indiscriminately.

**Acceptance:**

- Available, full, cancelled and past trips
- Requirements and price remain visible before submission
- Form anchors and sticky action land correctly

**Preserve/review:** Do not hide admission conditions or cancellation/payment terms.

**Source:** src/app/s/[shopSlug]/trips/[id]/page.tsx and composition

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes D03; queued for implementation or required verification.

- Historical/context: [PR #2048](https://github.com/AaronBuxbaum/diveday/pull/2048) — closed,
partial. Desktop form beside selected day; refined phone alternatives order remains.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
partial. Public booking cleanup, not phone-first selected-trip ordering.

**Evidence references in local artifact:** `current/public-trip-run-line-light-vw-390.png`,
`current/public-trip-run-line-light-vw-1280.png`

## D04

**Use one staff-preview context bar**

**Execution:** Ready to implement. Merge duplicate staff-preview context bars using existing return
destinations.

**Audit assessment (25 October):** still-open. Current staff preview still has the global Divers see
this page / Open the board bar and a separate departure-specific diver-view / Manage this trip
panel.

**Remaining observation:** Current staff preview still has the global Divers see this page / Open
the board bar and a separate departure-specific diver-view / Manage this trip panel.

**Audit direction:** Combine them into one compact preview bar with the most direct staff return
action and a secondary board link only if necessary.

**Acceptance:**

- Logged-in staff, anonymous diver and demo contexts
- No staff controls exposed to public visitors
- Phone bar does not obscure heading

**Source:** Public trip staff-preview components

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes D04; queued for implementation or required verification.

**Evidence references in local artifact:** `current/public-trip-run-line-light-vw-390.png`,
`current/public-trip-run-line-light-vw-1280.png`

## D05

**Name the booking party accurately**

**Execution:** Ready to implement. Rename party count People because existing participation choices
include snorkeling and riding; no mixed-party feature expansion.

**Audit assessment (25 October):** still-open. Current form still labels the count Number of divers
while Joining as supports diving, snorkeling and riding. Neutral seat counts improved elsewhere
without changing this label.

**Remaining observation:** Current form still labels the count Number of divers while Joining as
supports diving, snorkeling and riding. Neutral seat counts improved elsewhere without changing this
label.

**Audit direction:** Use “People” or “Party size” for the count, then the existing participation
choice. Make per-person role assumptions explicit for mixed parties if the form supports them.

**Acceptance:**

- One diver, snorkeler and rider
- Two-person and maximum-party layout
- Prices and capacity calculations unchanged

**Preserve/review:** Copy change only unless a separate mixed-party behavior issue is confirmed.

**Source:** Public trip BookingForm and diver locale bundle

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2251](https://github.com/AaronBuxbaum/diveday/issues/2251) — closed,
related. People terminology for every-seat operational counts; not booking-party input label.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes D05; implementation is in progress, not verified complete.

**Evidence references in local artifact:** `current/public-trip-participant-types-light-vw-390.png`,
`current/public-trip-participant-types-light-vw-1280.png`

## D06

**Choose course imagery that helps identify the course**

**Execution:** Retain current by owner choice. Owner explicitly chose to retain current behavior:
Keep current course imagery.

**Owner decision:** Keep current course imagery.

**Audit assessment (25 October):** still-open. Course list and detail still use generic wildlife:
stingray for Emergency Oxygen Provider, turtle for Open Water. Photo framing is improved, but
course-identifying imagery remains an editorial proposal.

**Remaining observation:** Course list and detail still use generic wildlife: stingray for Emergency
Oxygen Provider, turtle for Open Water. Photo framing is improved, but course-identifying imagery
remains an editorial proposal.

**Audit direction:** Use a small coherent set of authentic training images or text-led cards with
goal, duration and price. Avoid unrelated species imagery solely to fill a card.

**Acceptance:**

- Compare course list and detail as one family
- Appropriate licensing and alt text
- No image does not create an empty placeholder

**Preserve/review:** Do not invent instructor endorsements or course outcomes.

**Source:** src/app/s/[shopSlug]/courses/; course imagery data

**GitHub match:** missing-equivalent. No exact equivalent in all open records or recently updated
closed records; related items are context only.

- Historical/context: [Issue #2419](https://github.com/AaronBuxbaum/diveday/issues/2419) — closed,
related. Course image resolution, not authentic training imagery selection.

**Evidence references in local artifact:** `current/public-courses-light-vw-390.png`,
`current/public-courses-light-vw-1280.png`

## D07

**Explore goal-first course discovery**

**Execution:** Retain current by owner choice. Owner explicitly chose to retain current behavior:
Keep agency-first course discovery.

**Owner decision:** Keep agency-first course discovery.

**Audit assessment (25 October):** still-open. Agency tabs remain above the course groups. Existing
Start here and progression group headings help within an agency; goal-first discovery remains a
design exploration, not a confirmed failure.

**Remaining observation:** Agency tabs remain above the course groups. Existing Start here and
progression group headings help within an agency; goal-first discovery remains a design exploration,
not a confirmed failure.

**Audit direction:** Prototype grouping by first dive, certification, refresh and continuing
education, with agency as a secondary filter. Compare against the current agency-first structure
before committing.

**Acceptance:**

- New learner and agency-specific returning learner tasks
- Preserve exact agency/course identity and prerequisites
- No false equivalence between qualifications

**Preserve/review:** A deliberate information-architecture choice, not a confirmed usability
failure.

**Source:** Public course catalogue components

**GitHub match:** missing-equivalent. No exact equivalent in all open records or recently updated
closed records; related items are context only.

No equivalent issue or PR was found within the search boundary. This is not proof that older closed
records contain no overlap.

**Evidence references in local artifact:** `current/public-courses-light-vw-390.png`,
`current/public-courses-light-vw-1280.png`

## D08

**State shared package terms once**

**Execution:** Verify first. Need a fresh multi-package fixture to distinguish identical tank terms
from commercially distinct quantities/prices before further de-duplication; single-package capture
cannot show repetition.

**Audit assessment (25 October):** partially-resolved. Identical course-exclusion/scope terms now
appear once in the introduction and differing scopes stay with their cards. Tank accounting remains
per option. Current captures show only one package, so repeated-term comparison across multiple
packages still needs a fresh multi-option state.

**Remaining observation:** Identical course-exclusion/scope terms now appear once in the
introduction and differing scopes stay with their cards. Tank accounting remains per option. Current
captures show only one package, so repeated-term comparison across multiple packages still needs a
fresh multi-option state.

**Audit direction:** Keep the shared scope introduction and option-specific differences. In a fresh
multi-option state, assess quantity, total price, useful per-dive comparison and remaining
tank-accounting repetition; change only repetition still present.

**Acceptance:**

- Capture multiple packages with identical and differing scopes at phone and desktop
- Preserve tank accounting and commercially different terms
- Verify screen-reader association of shared scope with options

**Preserve/review:** Do not collapse legally or commercially different terms.

**Source:** src/app/s/[shopSlug]/packages/

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes D08; queued for implementation or required verification.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed,
partial. Shared package width/disclosure cleanup; remaining multi-option repetition needs fresh
check.

**Evidence references in local artifact:** `current/public-packages-light-vw-390.png`,
`current/public-packages-light-vw-1280.png`

## S01

**Establish a compact mobile collection header**

**Execution:** Ready to implement. Normalize existing mobile collection header hierarchy with
current primitives. Title/action, search, active filters, records; quiet existing exports. Do not
invent a new universal menu.

**Audit assessment (25 October):** still-open. Collection headers retain action/search/filter
stacks; StaffPage width normalization and course row Schedule removal do not implement compact
mobile header.

**Remaining observation:** Collection headers retain action/search/filter stacks; StaffPage width
normalization and course row Schedule removal do not implement compact mobile header.

**Audit direction:** Define a shared arrangement: title + primary action, one search field, compact
active filters, then records. Move export/public-preview into quiet header links or overflow. Apply
by family rather than bespoke CSS patches.

**Acceptance:**

- 390px, tablet and desktop
- First useful record visible earlier with 44px controls retained
- Empty, filtered, long-label and permission-limited states

**Preserve/review:** Reduce chrome, not touch targets. Do not collapse active filter state.

**Source:** src/app/shop/[shopSlug]/divers/page.tsx:246

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S01; queued for implementation or required verification.

- Historical/context: [PR #2886](https://github.com/AaronBuxbaum/diveday/pull/2886) — closed,
partial. Unified collections; does not establish the refined mobile header for every family.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed,
partial. Order/schedule header overflow, not complete cross-collection treatment.

**Evidence references in local artifact:**

## S02

**Make clipped filter choices discoverable**

**Execution:** Ready to implement. Make current chip overflow apparent using restrained existing
scroller/edge affordances. A new filter-builder UI is outside this safe scope.

**Audit assessment (25 October):** still-open. Shared FilterChips unchanged across audit commits;
hidden-option discovery proposal remains.

**Remaining observation:** Shared FilterChips unchanged across audit commits; hidden-option
discovery proposal remains.

**Audit direction:** Give overflow an explicit affordance or use a compact filter disclosure with a
visible active-filter summary and Clear. Compare with the existing strip; do not wrap every chip
into a large wall.

**Acceptance:**

- Long translated choices
- Keyboard access to every option
- Active hidden option remains named

**Source:** src/components/ui/FilterChips.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S02; queued for implementation or required verification.

- Historical/context: [PR #2886](https://github.com/AaronBuxbaum/diveday/pull/2886) — closed,
related. Collection patterns do not explicitly cover discoverable clipped filter overflow.

**Evidence references in local artifact:**

## S03

**Add a direct jump to Today’s outstanding work**

**Execution:** Ready to implement. Turn existing outstanding-work count into an anchor to the
existing queue; preserve boat/safety ordering and coordinate #2800.

**Audit assessment (25 October):** still-open. Current Today crew-clash phone still places Needs you
beneath four departure cards; top count has no queue jump.

**Remaining observation:** Current Today crew-clash phone still places Needs you beneath four
departure cards; top count has no queue jump.

**Audit direction:** Make the outstanding count a quiet jump to the queue, keeping active boats and
urgent safety exceptions prominent. Do not reorder the whole page solely around the queue.

**Acceptance:**

- No outstanding work, many items and boat at sea
- Jump moves focus meaningfully
- No duplicate live region announcements

**Preserve/review:** Coordinate with #2800; do not duplicate the existing changes-since-last-look
issue.

**Source:** src/app/shop/[shopSlug]/_components/today/DaySpine.tsx:1006

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S03; queued for implementation or required verification.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed,
partial. Needs-you rows rank by impact; no top outstanding-count jump.

**Evidence references in local artifact:** `current/today-crew-clash-light-vw-390.png`

## S04

**Let expanded help controls use the row width**

**Execution:** Ready to implement. Expand current Arrange help form across its parent row; keep
current actions and meanings.

**Audit assessment (25 October):** still-open. HelpRequestControl expanded form layout unchanged;
this interval adds handled-request reopening, not full-width expansion. Expanded interaction not
recaptured.

**Remaining observation:** HelpRequestControl expanded form layout unchanged; this interval adds
handled-request reopening, not full-width expansion. Expanded interaction not recaptured.

**Audit direction:** Keep the collapsed row compact; expand the resolution form below the summary
across the available width, with action and cancel together at its end.

**Acceptance:**

- Phone and desktop expanded state
- Long request, validation and save error
- Collapse returns focus to trigger

**Preserve/review:** Current wording is Arrange help, not the old Acknowledge flow. Do not reopen
that settled decision.

**Source:** src/app/shop/[shopSlug]/_components/today/HelpRequestControl.tsx:143

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2939](https://github.com/AaronBuxbaum/diveday/issues/2939) — closed,
related. Reopening handled requests; no resolution-form row-width hierarchy.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S04; queued for implementation or required verification.

**Evidence references in local artifact:**

## S05

**Make overdue work orders scannable by promise date**

**Execution:** Ready to implement. Reorder current work-order identity, promised date and complaint
for scanning; no new sorting or promised-date rules.

**Audit assessment (25 October):** still-open. Work-order list only adopts StaffPage; promised-date
row composition unchanged.

**Remaining observation:** Work-order list only adopts StaffPage; promised-date row composition
unchanged.

**Audit direction:** Lead each job with equipment/customer identity and a concise promised-date or
overdue line; put the detailed complaint beneath or inside the row.

**Acceptance:**

- Overdue, due today, no promise and completed jobs
- No color-only lateness
- Keep work status grouping

**Source:** src/app/shop/[shopSlug]/gear/work-orders/page.tsx:96

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S05; queued for implementation or required verification.

- Historical/context: [PR #2270](https://github.com/AaronBuxbaum/diveday/pull/2270) — closed,
related. Introduced work orders; not promise-date scanning.

**Evidence references in local artifact:**

## S06

**Show one current work-order status and a sensible next step**

**Execution:** Ready to implement. Use existing action-menu conventions for exceptional transitions
while retaining current state and ordinary forward action. No transition-rule changes.

**Audit assessment (25 October):** partially-resolved. Current status now static Badge and moves
secondary, resolving state-versus-action confusion. Alternate transitions remain inline peers rather
than menu.

**Remaining observation:** Current status now static Badge and moves secondary, resolving
state-versus-action confusion. Alternate transitions remain inline peers rather than menu.

**Audit direction:** Keep the new static status pill. Consider placing uncommon alternative
transitions in an overflow menu while retaining the ordinary forward move inline.

**Acceptance:**

- All four states, backward transition, save failure
- No automatic progression or accidental pickup
- Keyboard menu and focus return

**Source:** src/app/shop/[shopSlug]/gear/work-orders/_components/WorkOrderStatusCard.tsx:74

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S06; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Current state now a static badge; alternate transitions still equal-weight buttons.

**Evidence references in local artifact:**

## S07

**Give lost-property actions a clear hierarchy**

**Execution:** Ready to implement. Demote discard through the existing local action-menu pattern
while retaining consequence handling and a clear Return action.

**Audit assessment (25 October):** still-open. LostItemRow still uses peer secondary return and
discard controls; lost-found page only narrows shell and removes footer link.

**Remaining observation:** LostItemRow still uses peer secondary return and discard controls;
lost-found page only narrows shell and removes footer link.

**Audit direction:** Make return the obvious completion action, contact a quiet alternative and
discard an overflow action with its existing consequence/confirmation.

**Acceptance:**

- Unclaimed, contacted, returned and discarded records
- Recovery behavior unchanged
- Phone menu remains reachable

**Source:** src/components/lost-found/LostItemRow.tsx:60

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S07; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
related. Removed lost-found explanatory sentence, not return/contact/discard action hierarchy.

**Evidence references in local artifact:**

## S08

**Make the dive-site editor start with the editable record**

**Execution:** Ready to implement. Collapse upcoming site uses into existing disclosure grammar;
template replacement already moved below editor.

**Audit assessment (25 October):** partially-resolved. Template replacement moved below form into
disclosure. Upcoming-departures card remains expanded before editable fields.

**Remaining observation:** Template replacement moved below form into disclosure.
Upcoming-departures card remains expanded before editable fields.

**Audit direction:** Keep template replacement below the form in its disclosure. Collapse upcoming
uses into a count/disclosure so editable identity/fields appear first.

**Acceptance:**

- Zero, one and many upcoming trips
- Unsaved edits survive opening the disclosure
- Phone and tablet editor width

**Preserve/review:** Separate from the existing 1024px overflow issue #2895.

**Source:** src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx:241

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S08; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Template moved below one-form editor; upcoming-uses disclosure remains.

**Evidence references in local artifact:**

## S09

**Group mobile crew assignments by departure**

**Execution:** Ready to implement. Owner explicitly approved: Use departure-first staffing on phone.
Departure-first staffing changes the primary work orientation and potentially adds a second view; it
is an IA choice rather than copy consistency.

**Owner decision:** Use departure-first staffing on phone.

**Audit assessment (25 October):** still-open. Staffing remains person/day layout with repeated trip
name, now truncated; grouping proposal remains.

**Remaining observation:** Staffing remains person/day layout with repeated trip name, now
truncated; grouping proposal remains.

**Audit direction:** Show the departure once with its assigned people and roles below. Retain a
person-oriented view only where it helps schedule staff across departures.

**Acceptance:**

- Multiple people, unassigned roles and overlapping assignments
- Phone and desktop
- Each person remains independently actionable

**Source:** src/app/shop/[shopSlug]/staffing/_components/StaffingWeek.tsx:973

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes S09; queued for implementation or required verification.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed,
partial. Staffing time/action layout fixed; departure grouping remains.

- Historical/context: [PR #2068](https://github.com/AaronBuxbaum/diveday/pull/2068) — closed,
related. Crew view cleanup and feature switch.

**Evidence references in local artifact:**

## B01

**Place the remedy next to a readiness blocker**

**Execution:** Ready to implement. Place existing blocker-specific remedy beside the blocker. Do not
add unsupported actions or optimistic clearance; requires two domain reviews.

**Audit assessment (25 October):** still-open. Current desk capture shows Turn away on collapsed
blocked row while Send waiver remains inside expanded detail.

**Remaining observation:** Current desk capture shows Turn away on collapsed blocked row while Send
waiver remains inside expanded detail.

**Audit direction:** Put the relevant remedy beside the blocker, such as Send waiver or Review
certification. Keep turn-away available as a quieter exception. Show only actions supported by the
actual reason.

**Acceptance:**

- Unsigned waiver, missing cert, expired medical, multiple blockers
- Pending send, failure and duplicate click
- Readiness remains server-authoritative

**Preserve/review:** Safety-critical: preserve the booking/boarding distinction, no optimistic
clearance; two differently framed domain reviews.

**Source:** src/app/shop/[shopSlug]/trips/[id]/_components/RosterRow.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes B01; queued for implementation or required verification.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed,
partial. Turn away moved beside Blocked; reason-specific remedy remains.

**Evidence references in local artifact:** `current/trip-desk-light-vw-390.png`

## B02

**Separate boarding blockers from incomplete information**

**Execution:** Ready to implement. Separate existing cannot-board facts from optional missing
information; presentation only, retain admission/readiness gates and domain reviews.

**Audit assessment (25 October):** still-open. Current desk still groups optional missing emergency
contact and blocked waiver together under Still to clear with enabled Check in on optional rows.

**Remaining observation:** Current desk still groups optional missing emergency contact and blocked
waiver together under Still to clear with enabled Check in on optional rows.

**Audit direction:** Visually distinguish cannot-board reasons from information still worth
collecting, with precise headings or inline labels. Preserve the actual existing gates.

**Acceptance:**

- A truly blocked row and nonblocking missing-contact row side by side
- Check-in action matches authoritative gate
- No new requirement inferred from layout

**Preserve/review:** Do not make optional information mandatory or soften a medical/certification
gate.

**Source:** src/app/shop/[shopSlug]/trips/[id]/_components/roster-row-outstanding.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes B02; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
related. One explicit manifest status line; not boarding blockers vs information distinction.

**Evidence references in local artifact:** `current/trip-desk-light-vw-390.png`

## B03

**Organize expanded guest details around the immediate job**

**Execution:** Ready to implement. Group existing expanded person facts and disclose booking
exceptions; no change to actions or readiness data.

**Audit assessment (25 October):** still-open. Current expanded desk still mixes emergency/rental
facts, notes, move and removal in one long region. Manifest sheet improved separately.

**Remaining observation:** Current expanded desk still mixes emergency/rental facts, notes, move and
removal in one long region. Manifest sheet improved separately.

**Audit direction:** Group contact/preparation facts together; keep move/removal in a compact
Booking actions disclosure. Auto-open only the section relevant to a visible exception.

**Acceptance:**

- Long names, all optional facts, empty facts and multiple errors
- Expanded state on 390px and desktop
- No safety-critical exception hidden

**Source:** src/app/shop/[shopSlug]/trips/[id]/_components/roster-row-reference.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes B03; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
partial. Person sheet facts consolidated; booking-action disclosure still separate proposal.

**Evidence references in local artifact:** `current/trip-desk-light-vw-390.png`

## B04

**Make moving a booking a deliberate date-first choice**

**Execution:** Ready to implement. Require deliberate existing destination selection and group
destinations by date; keep capacity, eligibility, money and audit checks.

**Audit assessment (25 October):** still-open. Current move-seat capture still preselects Morning
Two-Tank destination; no explicit empty selection/date-first destination composition.

**Remaining observation:** Current move-seat capture still preselects Morning Two-Tank destination;
no explicit empty selection/date-first destination composition.

**Audit direction:** Group destinations by date, show time/availability succinctly, and require an
explicit chosen departure before enabling the move. Keep eligibility explanations adjacent to
unavailable destinations.

**Acceptance:**

- No eligible destination, one destination and a long season
- Full/cancelled destination and concurrent capacity change
- Cancel returns to the original guest row

**Preserve/review:** Retain transaction-time capacity checks, pricing/refund rules and audit
history.

**Source:** src/app/shop/[shopSlug]/trips/[id]/_components/seat-move.ts

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2141](https://github.com/AaronBuxbaum/diveday/issues/2141) — closed,
related. Move panel turnaround warnings; not date-first deliberate destination choice.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes B04; queued for implementation or required verification.

**Evidence references in local artifact:** `current/trip-roster-move-seat-light-vw-390.png`

## B05

**Name the time zone inside the move-departure editor**

**Execution:** Ready to implement. Name existing shop-local input timezone in its label; no timezone
conversion or booking-time rules change.

**Audit assessment (25 October):** still-open. Current native move-editor crop labels New departure
time without shop zone; surrounding board time rows also lack zone. Original precision concern
remains.

**Remaining observation:** Current move editor still gives date and time without a visible shop zone
beside the input.

**Audit direction:** Add the shop time zone to the time label or one nearby line; retain date/time
validation and clearly handle ambiguous daylight-saving values.

**Acceptance:**

- Staff device in a different zone
- DST overlap/gap and translated date format
- Saved time unchanged except the intended edit

**Preserve/review:** Operational precision; do not convert shop-local input to the device zone.

**Source:** src/app/shop/[shopSlug]/schedule/board/

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes B05; implementation is in progress, not verified complete.

**Evidence references in local artifact:** `current/schedule-builder-move-blocked-light-vw-390.png`

## B06

**Compose the day packet as one document**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
Resolve the packet composition proposal, with PDF verification recorded in V03/limits. Optional
A4/Letter review is not residual implementation work and should not leave this selectable as a
partially open task. Current packet region contains a considered paper document and no rider-control
leakage; RB06 exclusively owns the live-print leak.

**Audit assessment (25 October):** resolved. Resolve the packet composition proposal, with PDF
verification recorded in V03/limits. Optional A4/Letter review is not residual implementation work
and should not leave this selectable as a partially open task. Current packet region contains a
considered paper document and no rider-control leakage; RB06 exclusively owns the live-print leak.

**Remaining observation:** Resolve the packet composition proposal, with PDF verification recorded
in V03/limits. Optional A4/Letter review is not residual implementation work and should not leave
this selectable as a partially open task. Current packet region contains a considered paper document
and no rider-control leakage; RB06 exclusively owns the live-print leak.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Preserve/review:** Screen evidence only; verify print CSS/PDF before calling this a print defect.

**Source:** src/app/shop/[shopSlug]/trips/[id]/manifest/_components/ManifestPaper.tsx

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed, exact.
Paper packet composition implemented; audit resolves original proposal.

**Evidence references in local artifact:** `current/trip-packet-print.png`

## B07

**Keep the departure-log explanation from burying the record**

**Execution:** Verify first. First verify required departure provenance in actual print/export
before a screen-only explanatory disclosure; current compressed paragraph is already factual and no
evidentiary defect established.

**Audit assessment (25 October):** partially-resolved. Four intro paragraphs compressed to one muted
paragraph; native phone still has seven lines before summary. Full explanation disclosure remains
optional editorial proposal, not evidentiary defect.

**Remaining observation:** Four intro paragraphs compressed to one muted paragraph; native phone
still has seven lines before summary. Full explanation disclosure remains optional editorial
proposal, not evidentiary defect.

**Audit direction:** Keep the compressed factual preamble. Consider a screen-only explanation
disclosure only after verifying required provenance remains complete in print/export.

**Acceptance:**

- Open and closed disclosure
- Incomplete log, completed log and amended evidence
- PDF legal/provenance wording reviewed

**Preserve/review:** Legal/evidentiary review; do not obscure that later updates differ from facts
at departure.

**Source:** src/app/shop/[shopSlug]/trips/[id]/log/page.tsx:161

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes B07; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
partial. Compressed departure-log preamble implemented; optional screen-only disclosure remains
refinement.

**Evidence references in local artifact:** `current/departure-log-light-vw-390.png`

## B08

**Explain paper-release provenance in human terms**

**Execution:** Ready to implement. Use paper-specific recording/provenance copy matching existing
data. Preserve evidence limits; review with security and two domain experts.

**Audit assessment (25 October):** still-open. Paper record labels recording route but seal still
says Can’t be checked for changes; no paper-specific consequence wording.

**Remaining observation:** Paper record labels recording route but seal still says Can’t be checked
for changes; no paper-specific consequence wording.

**Audit direction:** Distinguish “Paper release recorded by staff” from digitally verifiable
evidence. Explain what is and is not verified, with original date/version and recorder prominent.

**Acceptance:**

- Paper, digital verified and digital verification failure
- Do not style paper provenance as a false success
- Exact release identity retained

**Preserve/review:** Security and domain review; never imply an unsigned or unverifiable release is
legally valid.

**Source:** src/i18n/locales/en-US/staff/waiversStaff.json:46

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #3002](https://github.com/AaronBuxbaum/diveday/issues/3002) — closed,
related. Historic waiver cutoff provenance; not plain-language paper-release verification copy.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes B08; queued for implementation or required verification.

**Evidence references in local artifact:**

## C01

**Add visible units to dock-day duration inputs**

**Execution:** Ready to implement. Add visible/accessibly named minutes to existing dock-day numeric
fields; units are settled precision, no new feature.

**Audit assessment (25 October):** still-open. Duration fields remain bare numbers; new unified
dock-day page no longer renders the old “Every number here is in minutes” section description. Add
units locally.

**Remaining observation:** Duration fields remain bare numbers; new unified dock-day page no longer
renders the old “Every number here is in minutes” section description. Add units locally.

**Audit direction:** Add “minutes” to each numeric input’s visible and accessible label/suffix;
preserve the existing bounds.

**Acceptance:**

- Zero-minute shore entries
- Phone, desktop and Spanish
- Derived timeline unchanged

**Source:** src/app/shop/[shopSlug]/settings/_components/editors/BoatsSitesEditors.tsx:374

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes C01; implementation is in progress, not verified complete.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
related. Dock-day form consolidated; visible minutes units are separate residual.

**Evidence references in local artifact:** `current/settings-dock-day-rhythm-light-vw-1280.png`,
`current/settings-dock-day-rhythm-light-vw-390.png`

## C02

**Make integration availability internally consistent**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
Unavailable provider cards and activation promise replaced by one truthful “More integrations come
later. Ask us…” footer. Native current capture confirms configured Zapier only.

**Audit assessment (25 October):** resolved. Unavailable provider cards and activation promise
replaced by one truthful “More integrations come later. Ask us…” footer. Native current capture
confirms configured Zapier only.

**Remaining observation:** Unavailable provider cards and activation promise replaced by one
truthful “More integrations come later. Ask us…” footer. Native current capture confirms configured
Zapier only.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Preserve/review:** Do not invent a notification or activation workflow.

**Source:** settings/integrations/page.tsx; integration-parts.tsx

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed, exact.
Only available provider cards remain; truthful future footer resolves audit.

**Evidence references in local artifact:** `current/settings-integrations-light-vw-1280.png`,
`current/settings-integrations-light-vw-390.png`

## C03

**Put importing before the reference manual**

**Execution:** Ready to implement. Place existing upload/preview before detailed reference table,
retaining essential exclusions before upload and full reference in disclosure.

**Audit assessment (25 October):** still-open. Import page unchanged; reference table still precedes
wizard.

**Remaining observation:** Import page unchanged; reference table still precedes wizard.

**Audit direction:** Move upload and preview earlier. Keep concise important exclusions above the
picker and place the full What comes across table in a disclosure.

**Acceptance:**

- First import, malformed file, duplicates and preview/commit separation
- Provenance and unsupported-data warning still visible

**Preserve/review:** Never weaken certification/medical provenance checks, validation or
preview-before-commit.

**Source:** src/app/shop/[shopSlug]/settings/import/page.tsx:258

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C03; queued for implementation or required verification.

**Evidence references in local artifact:**

## C04

**Label form ordering numbers and move metadata below long legal titles**

**Execution:** Ready to implement. Give existing order/max-age fields visible labels and full-width
legal titles; retain medical age exception.

**Audit assessment (25 October):** still-open. Unified course form still puts order input in
separate right w-20 wrapper with aria-label only; full-title/layout proposal remains.

**Remaining observation:** Unified course form still puts order input in separate right w-20 wrapper
with aria-label only; full-title/layout proposal remains.

**Audit direction:** Give each form a full-width checkbox/title row. Beneath it place visibly
labelled Display order and optional maximum age fields; keep the age exception absent for medical
forms.

**Acceptance:**

- Order and age are distinguishable without assistive technology
- Long legal titles wrap without abbreviation
- Unchecked and medical forms retain exact selection/age semantics

**Preserve/review:** No change to signing requirements or mandatory medical screening; expand
existing C04 rather than duplicate it

**Source:** src/app/shop/[shopSlug]/courses/[slug]/edit/_components/CourseFormsRequirement.tsx:210

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes C04; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
related. Course editor unified save; labelled order fields remain a separate layout proposal.

**Evidence references in local artifact:**
`current/course-editor-required-forms-open-light-vw-1280.png`,
`current/course-editor-required-forms-open-light-vw-390.png`

## C05

**Lead active sessions with device identity**

**Execution:** Verify first. Source already groups sessions by device/current/last activity. Fresh
session screenshots and revocation/error states are required; no remaining implementation defect is
established.

**Audit assessment (25 October):** needs-verification. Source now leads grouped sessions with
browser/platform, includes-current marker and last activity; no security/session capture exists in
current CI actuals to validate composition.

**Remaining observation:** Source now leads grouped sessions with browser/platform, includes-current
marker and last activity; no security/session capture exists in current CI actuals to validate
composition.

**Audit direction:** Verify current session grouping, device labels, last activity and revocation
states in fresh screenshots before proposing any remaining change.

**Acceptance:**

- Same-browser devices, missing user agent and current device
- Reauthentication and revocation failure
- No optimistic successful revocation

**Preserve/review:** Security review for any behavior change; copy/layout only is the preferred
scope.

**Source:** settings/security/_components/AccountSessionsList.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C05; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Device-grouped active sessions implemented; fresh rendered verification remains.

**Evidence references in local artifact:**

## C06

**Remove secret-storage implementation copy**

**Execution:** Ready to implement. Remove implementation-facing secret-storage clause; keep user
consequence, reauthentication and recovery warnings.

**Audit assessment (25 October):** still-open. English bundle still says Disabling it removes the
stored secret.

**Remaining observation:** English bundle still says Disabling it removes the stored secret.

**Audit direction:** Replace this clause with the user consequence, if needed, while retaining
reauthentication and recovery-code warnings.

**Acceptance:**

- Authenticator enabled/disabled and recovery flow
- No suggestion that disabling is recommended

**Source:** settings/security/page.tsx and settings.security bundle

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes C06; implementation is in progress, not verified complete.

**Evidence references in local artifact:**

## C07

**Show a useful embed before nine format choices**

**Execution:** Ready to implement. Owner explicitly approved: Use Calendar/Button defaults with
other formats secondary. Choosing Calendar/Button/More replaces nine visible formats with a new
selector hierarchy; common formats should be chosen deliberately.

**Owner decision:** Use Calendar/Button defaults with other formats secondary.

**Audit assessment (25 October):** still-open. Nine equal format tiles still precede Open the
preview; iframe loading polish does not change selection hierarchy.

**Remaining observation:** Nine equal format tiles still precede Open the preview; iframe loading
polish does not change selection hierarchy.

**Audit direction:** Show the default calendar preview with a compact Calendar / Button / More
formats choice. Group QR and partner links as sharing formats. Choose common formats deliberately.

**Acceptance:**

- Every existing embed kind still reachable
- Course/departure selectors and kind reset
- Phone preview and copied code are consistent

**Source:** settings/embed/EmbedGenerator.tsx:180

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C07; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Embed preview/load/code controls cleaned; nine formats remain separate scope.

**Evidence references in local artifact:** `current/settings-embed-light-vw-1280.png`,
`current/settings-embed-light-vw-390.png`

## C08

**Lead backups with evidence of successful delivery**

**Execution:** Ready to implement. Promote already available verifiedAt/delivery state and Test
delivery; disclose destination identifiers/editing, open setup when incomplete. No new backup
tracking feature.

**Audit assessment (25 October):** still-open. BackupsSection unchanged. Delivery-first composition
not implemented.

**Remaining observation:** BackupsSection unchanged. Delivery-first composition not implemented.

**Audit direction:** Show last delivery/result, a short destination and Test delivery. Put
identifiers and editing behind Destination details; expand setup automatically when incomplete.

**Acceptance:**

- Never configured, success, failed and stale delivery
- Removal consequence remains explicit
- No secret values rendered

**Preserve/review:** The identifier is clutter here, not an asserted secret exposure.

**Source:** settings/export/_components/BackupsSection.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C08; queued for implementation or required verification.

**Evidence references in local artifact:** `current/settings-backups-light-vw-1280.png`

## C09

**Replace email badge-plus-button with one stateful control**

**Execution:** Ready to implement. Use existing switch grammar for reversible email preferences with
pending/error feedback; preserve toggle semantics and previews.

**Audit assessment (25 October):** still-open. Current email capture still pairs On badge with Turn
off in both sections.

**Remaining observation:** Current email capture still pairs On badge with Turn off in both
sections.

**Audit direction:** Use one clearly labeled switch beside the section title; keep previews
secondary and persist/error feedback explicit.

**Acceptance:**

- Keyboard and screen-reader switch state
- Save failure restores real value
- No accidental sends triggered

**Preserve/review:** Only reversible preferences; do not apply this pattern to sending or safety
actions.

**Source:** settings/email/page.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C09; queued for implementation or required verification.

**Evidence references in local artifact:** `current/settings-email-light-vw-1280.png`,
`current/settings-email-light-vw-390.png`

## C10

**Summarize team credentials without hiding exceptions**

**Execution:** Ready to implement. Summarize existing credential lists with count while preserving
exceptions at rest. H-59 forbids new gates; two domain reviews.

**Audit assessment (25 October):** still-open. Credential exceptions now stand at rest, but
collapsed summaries still print full long qualification lists; current native phone image confirms.

**Remaining observation:** Credential exceptions now stand at rest, but collapsed summaries still
print full long qualification lists; current native phone image confirms.

**Audit direction:** Use a count plus any expiring/missing qualification exception. Keep full names
and renewals inside the section; never collapse a role-critical deficiency into a generic count.

**Acceptance:**

- Current, soon-expiring, expired and missing credentials
- Long name and no languages
- No row-wide form expansion

**Preserve/review:** Domain review of safety qualification prominence.

**Source:** settings/team/_components/StaffCardCredentials.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes C10; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Exceptions shown on staff cards; long collapsed credential summaries remain.

**Evidence references in local artifact:** `current/settings-team-light-vw-1280.png`,
`current/settings-team-light-vw-390.png`

## C11

**Make activity feel like a ledger**

**Execution:** Ready to implement. Render existing activity as grouped ledger rows and disclose
unused date controls; show active range and Clear, no new search engine.

**Audit assessment (25 October):** still-open. Activity component unchanged; boxed event/filter
composition remains.

**Remaining observation:** Activity component unchanged; boxed event/filter composition remains.

**Audit direction:** Use date groups and light event rows with actor/action/record together. Keep
common filters compact and put unused date range behind Filter; show active range and Clear.

**Acceptance:**

- Empty, filtered and paginated states
- Long actor and record names
- Exact timestamp and all audit facts retained

**Source:** settings/activity/page.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2314](https://github.com/AaronBuxbaum/diveday/issues/2314) — closed,
related. Visible From/To labels, not date-grouped ledger and filter disclosure.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C11; queued for implementation or required verification.

**Evidence references in local artifact:** `current/settings-activity-light-vw-1280.png`

## C12

**Simplify the two calendar subscription scopes**

**Execution:** Ready to implement. Remove repeated scope descriptions and empty-state text; retain
actual feed controls, revoke action and synchronization warning.

**Audit assessment (25 October):** still-open. Both create controls now secondary, but repeated
descriptions and Not subscribed yet remain in current pair.

**Remaining observation:** Both create controls now secondary, but repeated descriptions and Not
subscribed yet remain in current pair.

**Audit direction:** Use two concise scope rows with one Create action; once created show actual URL
controls and revoke. Keep the synchronization-lag warning visible.

**Acceptance:**

- Not created, created and revoked
- Scope distinction and copy/download actions
- No implication this is live operational truth

**Source:** settings/calendar/page.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes C12; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Create weight changed.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed,
partial. Both create controls equal secondary weight; scope-row simplification remains.

**Evidence references in local artifact:** `current/settings-calendar-light-vw-1280.png`,
`current/settings-calendar-light-vw-390.png`

## C13

**Remove the unavailable WhatsApp call to action**

**Execution:** Ready to implement. Replace disabled unavailable Connect with truthful availability
and existing-SMS consequence; do not build WhatsApp signup.

**Audit assessment (25 October):** still-open. WhatsApp component unchanged; original unavailable
disabled-connect finding remains.

**Remaining observation:** WhatsApp component unchanged; original unavailable disabled-connect
finding remains.

**Audit direction:** Replace the dead control with one explicit availability statement and
reassurance that existing SMS continues. Only show Connect when the integration can accept signup.

**Acceptance:**

- Unavailable, eligible, connected and reconnect states
- No unimplemented Notify me control

**Source:** settings/whatsapp/page.tsx:145

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2958](https://github.com/AaronBuxbaum/diveday/issues/2958) — open,
related. Human-owned Meta approval/deployment needed to enable WhatsApp; unavailable Connect UI can
be fixed independently.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes C13; implementation is in progress, not verified complete.

**Evidence references in local artifact:**

## C14

**Let the shop tagline be read while edited**

**Execution:** Ready to implement. Use existing textarea/autosize pattern so tagline is readable;
preserve 120-character limit and current save.

**Audit assessment (25 October):** still-open. Tagline remains single-line text input maxLength 120;
current profile phone capture visibly clips saved tagline.

**Remaining observation:** Tagline remains single-line text input maxLength 120; current profile
phone capture visibly clips saved tagline.

**Audit direction:** Use an autosizing two-to-three-line textarea, retaining maxlength and
validation. Avoid duplicating the same prose in a preview unless necessary.

**Acceptance:**

- Long text, unbroken string, Spanish and 200% zoom
- Saved shopfront rendering unchanged

**Source:** settings/_components/editors/ profile/branding fields

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes C14; implementation is in progress, not verified complete.

**Evidence references in local artifact:** `current/settings-profile-light-vw-1280.png`,
`current/settings-profile-light-vw-390.png`

## C15

**Shorten the safety page’s preamble on screen**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
Resolve the original screen-preamble proposal: current phone and desktop confirm the shorter ledger.
Do not reclassify a removed qualification as a confirmed defect merely because the old design
suggestion said to preserve it. There is no demonstrated legal requirement or rendered false
interpretation here.

**Audit assessment (25 October):** resolved. Resolve the original screen-preamble proposal: current
phone and desktop confirm the shorter ledger. Do not reclassify a removed qualification as a
confirmed defect merely because the old design suggestion said to preserve it. There is no
demonstrated legal requirement or rendered false interpretation here.

**Remaining observation:** Resolve the original screen-preamble proposal: current phone and desktop
confirm the shorter ledger. Do not reclassify a removed qualification as a confirmed defect merely
because the old design suggestion said to preserve it. There is no demonstrated legal requirement or
rendered false interpretation here.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Preserve/review:** Do not imply absence of recorded incidents proves safety or compliance.

**Source:** src/app/shop/[shopSlug]/safety/

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed, exact.
Safety preamble shortened to linked count tiles; audit resolves original scope.

**Evidence references in local artifact:** `current/reports-safety-light-vw-1280.png`,
`current/reports-safety-light-vw-390.png`

## R01

**Expose Change plans beside the trip date**

**Execution:** Ready to implement. Link trip-date context to existing request section and show
existing pending state. Preserve booking date until staff confirms.

**Audit assessment (25 October):** still-open. Current pending-move phone capture still places the
request after packing, the day rhythm, flying guidance and log-entry preview; nothing beside the
date exposes Change plans or pending status. Booking-stays-until-confirmed wording remains intact.

**Remaining observation:** Current pending-move phone capture still places the request after
packing, the day rhythm, flying guidance and log-entry preview; nothing beside the date exposes
Change plans or pending status. Booking-stays-until-confirmed wording remains intact.

**Audit direction:** Add a quiet Change plans link beside the trip date that opens/jumps to the
existing request section. Show an existing pending request by the date; keep refund/cancellation
detail in its proper context.

**Acceptance:**

- Fresh current token capture first
- No request, pending, accepted, declined and cancelled states
- Booking remains unchanged until shop approval

**Preserve/review:** Do not implement instant self-rescheduling; validate against current main
before filing as a defect. Preserve the statement that the booking stays on its existing date until
a move is confirmed.

**Source:** src/app/ready/[token]/_components/ThreadSections.tsx:194; MoveAsk.tsx:61

**GitHub match:** exact-existing. Exact execution target: issue #3074 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2666](https://github.com/AaronBuxbaum/diveday/issues/2666) — closed,
related. Captures ask-to-move state; not Change plans door beside date.

- Execution: [Issue #3074](https://github.com/AaronBuxbaum/diveday/issues/3074) — open, exact.
Execution issue #3074 explicitly includes R01; queued for implementation or required verification.

**Evidence references in local artifact:** `current/ready-asked-to-move-light-vw-390.png`,
`current/ready-asked-to-move-light-vw-1280.png`

## RB01

**Make offline crew identities dock-readable**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
Native phone crew crop now gives Keiko name own bold line and explicit 16px awaiting-roll-call
status, buddy names beneath. Source text-base confirms intended critical text.

**Audit assessment (25 October):** resolved. Native phone crew crop now gives Keiko name own bold
line and explicit 16px awaiting-roll-call status, buddy names beneath. Source text-base confirms
intended critical text.

**Remaining observation:** Native phone crew crop now gives Keiko name own bold line and explicit
16px awaiting-roll-call status, buddy names beneath. Source text-base confirms intended critical
text.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/components/offline-manifest/CrewRollCall.tsx:120

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed, exact.
Offline crew/person identities and explicit status are readable in current audit.

**Evidence references in local artifact:** `current/offline-manifest-roll-call-light-vw-390.png`,
`current/offline-manifest-roll-call-light-vw-1280.png`

## RB02

**Give touch users a direct route to offline roll call**

**Execution:** Ready to implement. Use plain anchored Roll call/Emergency reference links to
existing sections; this is navigation to an existing job, not new operational state.

**Audit assessment (25 October):** still-open. Current saved-manifest phone still requires passing
emergency/checklist/counter to reach checkpoint and crew; only keyboard SkipLink, no visible touch
jump.

**Remaining observation:** Current saved-manifest phone still requires passing
emergency/checklist/counter to reach checkpoint and crew; only keyboard SkipLink, no visible touch
jump.

**Audit direction:** Add a visible, large-target “Roll call” jump immediately below the saved-copy
status, plus a corresponding return to emergency reference near the roll-call heading. Keep
emergency information first and retain separate counter and boat lists; do not silently merge
arrival with aboard. A restrained anchored section navigator is sufficient.

**Acceptance:**

- At390px a touch user can reach active checkpoint and first roll-call rows with one tap.
- All emergency contact/reference content remains available offline and retains its prominent first
  position.
- Keyboard skip, focus destination, expired-copy refusal, pending changes and checkpoint-gap
  warnings still work.

**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/components/offline-manifest/TripScreen.tsx:46

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RB02; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
partial. Still-to-board jump added; direct touch route from saved status to roll call remains.

**Evidence references in local artifact:** `current/offline-manifest-roll-call-light-vw-390.png`

## RB03

**Keep packing names and sizes readable on a phone**

**Execution:** Ready to implement. Raise existing identifying packing text to 16px and rebalance
wrapping columns; keep one ledger and quantities.

**Audit assessment (25 October):** still-open. Packing row retains text-sm and fixed 6.5rem item
column; current prep assignment phone keeps small dense names/sizes.

**Remaining observation:** Packing row retains text-sm and fixed 6.5rem item column; current prep
assignment phone keeps small dense names/sizes.

**Audit direction:** Raise identifying packing facts to16px. Rebalance the fixed6.5rem item column
and wrapping name column at390px; if necessary put recipient names on a second line, keeping
item/size and quantity on the first. Keep one shared ledger rather than returning to a card for
every piece.

**Acceptance:**

- Measure16px critical values at390px; no clipped size or quantity with long names.
- Keep unanswered fit distinct from own kit and known size; preserve totals and print table.

**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/app/shop/[shopSlug]/trips/[id]/prep/_components/prep-lines.tsx:271

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RB03; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
related. Prep fit and tank composition changed; packing table phone text/readability remains.

**Evidence references in local artifact:** `current/prep-assignments-light-vw-390.png`

## RB04

**Restore cancellation recovery facts on mobile**

**Execution:** Ready to implement. Reveal currently hidden payment/offer facts in mobile recovery
row, with existing disclosure conventions; no new recovery logic.

**Audit assessment (25 October):** still-open. Current blowout phone still omits Money/Offered
columns; source hideBelow sm/md remains.

**Remaining observation:** Current blowout phone still omits Money/Offered columns; source hideBelow
sm/md remains.

**Audit direction:** Use a mobile recovery row with name and message/status first, payment exception
beneath, and an expandable offered-departures summary. Keep “No qualifying dates” visible for
unresolved people. Do not render all three offered trips expanded for every person.

**Acceptance:**

- At390px recover every Money/Offered fact available at1280px without navigating away.
- Cover paid/deposit/no payment, no-email phone recovery, no qualifying dates, sent/unsent and
  rebooked/unresolved.
- Distinguish offers from an actual confirmed new booking; never imply refund completed merely
  because cancellation happened.

**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/app/shop/[shopSlug]/schedule/blowout/[tripId]/page.tsx:339

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2460](https://github.com/AaronBuxbaum/diveday/issues/2460) — closed,
related. Blow-out title metadata; not mobile recovery facts.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RB04; queued for implementation or required verification.

**Evidence references in local artifact:** `current/blowout-cascade-light-vw-390.png`,
`current/blowout-cascade-light-vw-1280.png`

## RB05

**Put unresolved cancellation work before settled rows**

**Execution:** Ready to implement. Order existing unresolved work first and anchor existing count;
keep undelivered-message exceptions visible even for rebooked people.

**Audit assessment (25 October):** still-open. Current blowout list still alphabetic and count 2
unresolved not a jump/filter; Mara/Owen remain among settled rows.

**Remaining observation:** Current blowout list still alphabetic and count 2 unresolved not a
jump/filter; Mara/Owen remain among settled rows.

**Audit direction:** Make the unresolved count an anchor/filter to unresolved rows; order recovery
work ahead of settled bookings, then show settled people in a quiet separate group. Keep undelivered
messages actionable across both groups so rebooked is not mistaken for fully contacted.

**Acceptance:**

- Two unresolved people are reachable with one tap from summary.
- A rebooked person with failed notification remains visible in notification work; no status is
  suppressed.

**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/app/shop/[shopSlug]/schedule/blowout/[tripId]/page.tsx:280

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RB05; queued for implementation or required verification.

**Evidence references in local artifact:** `current/blowout-cascade-light-vw-390.png`

## RB06

**Remove a nonfunctional add-rider control from printed manifests**

**Execution:** Ready to implement. Hide live Add a rider disclosure in print, keeping actual rider
identities and already-fixed packet rendering.

**Audit assessment (25 October):** partially-resolved. Packet print no longer includes Add a rider
via ManifestPaper/DockDesk paper=true, but native live manifest-print crop still prints the closed
Add a rider disclosure. Narrow remaining change to live print path.

**Remaining observation:** Packet print no longer includes Add a rider via ManifestPaper/DockDesk
paper=true, but native live manifest-print crop still prints the closed Add a rider disclosure.
Narrow remaining change to live print path.

**Audit direction:** Hide the live-manifest DockRiderForm disclosure in print; retain the new packet
paper path and all actual rider identities.

**Acceptance:**

- Regenerate live manifest print and trip packet: no “Add a rider” action text, input affordances or
  screen-only buttons.
- Actual rider identity, capacity totals, emergency contact, medical disclosure policy and
  missing-person instructions remain.

**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DockDesk.tsx:52

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RB06; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
partial. Packets suppress rider controls; live manifest print disclosure still leaks.

**Evidence references in local artifact:** `current/manifest-print.png`,
`current/trip-packet-print.png`

## RB07

**Say a diver’s rental fit once in the person sheet**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
Native Priya phone sheet subtitle now Diver · age 27, explicit status line; complete rental list
appears exactly once under Rental fit.

**Audit assessment (25 October):** resolved. Native Priya phone sheet subtitle now Diver · age 27,
explicit status line; complete rental list appears exactly once under Rental fit.

**Remaining observation:** Native Priya phone sheet subtitle now Diver · age 27, explicit status
line; complete rental list appears exactly once under Rental fit.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCallRow.tsx:169

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed, exact.
Rental fit occurs once in person sheet; original audit proposal resolved.

**Evidence references in local artifact:** `current/manifest-person-panel-light-vw-390.png`,
`current/manifest-person-panel-light-vw-1280.png`

## RB08

**Let gear staff reach assignment work before scrolling the entire pull list**

**Execution:** Ready to implement. Anchor task-count links to existing pull and assignment sections;
no duplicated assignment data or new tab system.

**Audit assessment (25 October):** still-open. Prep phone still puts Rental assignments below full
packing ledger without in-page assignment jump.

**Remaining observation:** Prep phone still puts Rental assignments below full packing ledger
without in-page assignment jump.

**Audit direction:** Place compact in-page links near the top labeled with actual task counts, e.g.
“Pull list” and “25 pieces to assign”, leading to existing sections. Keep the stock-pull overview
available and preserve the stable screen order; avoid introducing a second independently edited
source of truth.

**Acceptance:**

- Assignment list is reachable in one tap from top at390px.
- Anchor lands clear of fixed dock; headings receive focus for keyboard navigation.
- Sailed/cancelled/home states do not expose assignment tasks that no longer apply.

**Preserve/review:** Preserve domain rules and test phone, tablet where covered, desktop and print
where affected; safety changes require two differently framed dive-domain-expert reviews.

**Source:** src/app/shop/[shopSlug]/trips/[id]/prep/_components/PrepBody.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RB08; queued for implementation or required verification.

- Historical/context: [PR #3053](https://github.com/AaronBuxbaum/diveday/pull/3053) — closed,
partial. Prep counts now coherent; assignment-section navigation remains.

**Evidence references in local artifact:** `current/prep-assignments-light-vw-390.png`

## RB09

**Name the cancellation follow-up page in operational language**

**Execution:** Ready to implement. Replace implementation term cascade with Cancelled departure in
heading and inbound link; behavior unchanged.

**Audit assessment (25 October):** still-open. Current native blowout screen remains Blow-out
cascade; bundle and inbound link still name cascade.

**Remaining observation:** Current native blowout screen remains Blow-out cascade; bundle and
inbound link still name cascade.

**Audit direction:** Rename the page heading to “After the blow-out” or “Cancelled departure”,
keeping the affected trip and date immediately below. Use the same wording on the inbound “View the
blow-out cascade” link.

**Acceptance:**

- English/Spanish headings and inbound links agree; distinguish confirmation-before-cancellation
  from recovery-after-cancellation.

**Preserve/review:** Copy only; preserve cancellation/refund behavior and legal consequences.

**Source:** src/i18n/locales/en-US/staff/blowout.json:15

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2460](https://github.com/AaronBuxbaum/diveday/issues/2460) — closed,
related. Cause-aware browser title only; operational visible heading and inbound label remain.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes RB09; implementation is in progress, not verified
complete.

**Evidence references in local artifact:** `current/blowout-cascade-light-vw-390.png`

## RR01

**Translate every order line type, including e-learning**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
KIND_KEYS now exhaustive OrderLineItemKind map includes e_learning_fee; dispute helper falls back to
localized Other. Native current open order shows e-Learning fee.

**Audit assessment (25 October):** resolved. KIND_KEYS now exhaustive OrderLineItemKind map includes
e_learning_fee; dispute helper falls back to localized Other. Native current open order shows
e-Learning fee.

**Remaining observation:** KIND_KEYS now exhaustive OrderLineItemKind map includes e_learning_fee;
dispute helper falls back to localized Other. Native current open order shows e-Learning fee.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Source:** src/app/shop/[shopSlug]/orders/[id]/order-detail-keys.ts:27; page.tsx:235;
print/dispute/page.tsx:145

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed, exact.
Exhaustive order-line kind labels include e_learning_fee.

**Evidence references in local artifact:** `current/order-detail-open-demo-light-vw-1280.png`,
`current/order-detail-open-demo-light-vw-390.png`

## RR02

**Start an invoice with one line instead of four empty forms**

**Execution:** Ready to implement. Owner explicitly approved: Build dynamic invoice lines with
Add/Remove and subtotal. Current parser and page share LINE_ITEM_ROWS=4. Dynamic add/remove and
running subtotal introduce new client state rather than merely hiding duplicate text.

**Owner decision:** Build dynamic invoice lines with Add/Remove and subtotal.

**Audit assessment (25 October):** still-open. New order still renders four empty item blocks;
current desktop/phone confirms.

**Remaining observation:** New order still renders four empty item blocks; current desktop/phone
confirms.

**Audit direction:** Start with one line (or populated booking/course defaults). Put Add another
item after the current last line and an accessible Remove on added lines. Show a running subtotal
adjacent to the send action.

**Acceptance:**

- One-item and multi-item invoices at390 and1280
- No blank items sent, complete lines retained on validation errors
- Creation and server parsing support identical bounded item counts

**Preserve/review:** Preserve required billing address, tax calculation, payment authorization and
explicit send action.

**Source:** src/app/shop/[shopSlug]/orders/new/page.tsx:256; order-form.ts:10

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RR02; queued for implementation or required verification.

**Evidence references in local artifact:** `current/orders-new-light-vw-1280.png`,
`current/orders-new-light-vw-390.png`

## RR03

**Give the gear record a maintenance-led composition**

**Execution:** Ready to implement. Disclose empty note editor and move existing service-due facts
toward identity; no service/rental-hold rule change.

**Audit assessment (25 October):** partially-resolved. Status/details combined, Edit moved to
header, Pull for service precedes service and Delete moved to foot. Native tank still has full empty
Notes card and quiet maintenance action far below identity.

**Remaining observation:** Status/details combined, Edit moved to header, Pull for service precedes
service and Delete moved to foot. Native tank still has full empty Notes card and quiet maintenance
action far below identity.

**Audit direction:** Keep the combined status/details panel and foot Delete; replace empty Notes
card with one Add a note disclosure and bring due-service facts closer to identity.

**Acceptance:**

- At390 current condition, due service and appropriate maintenance action precede optional metadata
- Concern, reserved, checked-out, deleted and tank inspection states remain explicit
- No loss of history or safety holds

**Preserve/review:** Do not equate logging a service with returning an item to service or bypass
rental holds.

**Source:** src/app/shop/[shopSlug]/gear/[id]/page.tsx:308,406,505,548

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes RR03; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Combined status/details panel.

- Historical/context: [PR #3037](https://github.com/AaronBuxbaum/diveday/pull/3037) — closed,
partial. Delete moved to foot and empty service/history state reduced; audit retains
note/maintenance refinement.

**Evidence references in local artifact:** `current/gear-unit-light-vw-1280.png`,
`current/gear-unit-light-vw-390.png`

## RR04

**Make a collected work order read like a finished record**

**Execution:** Ready to implement. Show collected work orders as readable records with local Edit
controls for existing corrections; Paid remains independent of Collected.

**Audit assessment (25 October):** still-open. Collected work-order presentation only changed shell
width; complaint/work fields and payment controls remain editable at rest in current pair.

**Remaining observation:** Collected work-order presentation only changed shell width;
complaint/work fields and payment controls remain editable at rest in current pair.

**Audit direction:** For collected tickets show the job, work performed, completed date,
bill/payment state and history as readable record content. Reveal existing correction forms from
clearly named local Edit controls; keep corrections available rather than making the record
immutable.

**Acceptance:**

- Picked up and active tickets have intentionally distinct presentation
- Correct a collected note or line with existing permission and audit behavior
- Outstanding payment remains an obvious action even after pickup

**Preserve/review:** Do not infer Paid from Picked up; preserve staff-only versus customer-visible
notes.

**Source:** src/app/shop/[shopSlug]/gear/work-orders/[workOrderId]/page.tsx:182,229;
_components/WorkOrderJobCard.tsx:38; WorkOrderLinesCard.tsx:47

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes RR04; queued for implementation or required verification.

- Historical/context: [PR #2276](https://github.com/AaronBuxbaum/diveday/pull/2276) — closed,
related. Work-order billing/ready notification feature, not finished-record composition.

**Evidence references in local artifact:** `current/work-order-ticket-collected-light-vw-1280.png`,
`current/work-order-ticket-collected-light-vw-390.png`

## RR05

**Keep parts and labor addition out of the resting ticket**

**Execution:** Ready to implement. Disclose existing part/labor add form at list foot; retain form
on error and line-local menus. No charging semantics change.

**Audit assessment (25 October):** still-open. WorkOrderLinesCard unchanged; blank four-field add
form remains at rest on current collected ticket.

**Remaining observation:** WorkOrderLinesCard unchanged; blank four-field add form remains at rest
on current collected ticket.

**Audit direction:** Replace the blank add form at rest with Add part or labor at the list foot.
Open the form in place and retain it on errors; keep existing line menus attached to the line. After
successful add, return to the updated line and total.

**Acceptance:**

- Add, edit, delete, validation and undo states at390 and1280
- New line and changed total visible after save
- Multiple additions remain efficient with keyboard focus returned intentionally

**Preserve/review:** Ticket arithmetic and billing are distinct; this must not charge a customer.

**Source:** src/app/shop/[shopSlug]/gear/work-orders/_components/WorkOrderLinesCard.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes RR05; queued for implementation or required verification.

**Evidence references in local artifact:** `current/work-order-ticket-collected-light-vw-1280.png`,
`current/work-order-ticket-collected-light-vw-390.png`

## RR06

**Say the unsighted nitrox status once within its card**

**Execution:** Ready to implement. Remove duplicated self-declared detail only when it adds no
identifier/provenance; keep explicit unsighted state and Verify action.

**Audit assessment (25 October):** still-open. CertificationsGroup unchanged; current
diver-level-card-sighting and nitrox-card-sighting overview captures confirm duplicated
self-declared sentence remains.

**Remaining observation:** CertificationsGroup unchanged; duplicate unsighted nitrox status remains
source-supported, no new native nitrox inspection this pass.

**Audit direction:** Retain one explicit icon-and-text unsighted status; omit the duplicated detail
when it carries no identifier or additional provenance. Preserve the Verify certification record
action and agency-specific sighting guidance.

**Acceptance:**

- Unsighted nitrox has one visible status sentence
- Sighted/imported/pending records preserve distinct identifiers and provenance
- No gate changes

**Preserve/review:** Safety-critical presentation: two domain reviews; never infer verification from
self-declaration.

**Source:** src/app/shop/[shopSlug]/divers/[personId]/_components/CertificationsGroup.tsx:604–612

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2592](https://github.com/AaronBuxbaum/diveday/issues/2592) — closed,
related. Agency-check action on specialty/nitrox cards; duplicate unsighted wording remains.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RR06; queued for implementation or required verification.

**Evidence references in local artifact:**
`current/diver-level-card-sighting-open-light-vw-390.png`,
`current/diver-nitrox-card-sighting-open-light-vw-390.png`

## RR07

**Identify the surviving duplicate beside the merge action**

**Execution:** Ready to implement. Repeat distinguishing existing survivor identity/count beside
destructive merge action and update it on keeper swap. No extra confirmation step.

**Audit assessment (25 October):** partially-resolved. Email wraps better across half-card columns.
Native current phone still ends with Merge into Priya Sharma without nearby distinguishing
contact/count.

**Remaining observation:** Email wraps better across half-card columns. Native current phone still
ends with Merge into Priya Sharma without nearby distinguishing contact/count.

**Audit direction:** Add the surviving record's distinguishing email or phone plus booking count
immediately above the existing merge action. Keep the choice in the comparison, and update the
destination when keeper swaps. Do not add another confirmation step.

**Acceptance:**

- Same-name/same-day records remain distinguishable at the commit point
- Long emails, absent contact details and shared departures covered
- Summary changes correctly when keeper is swapped

**Preserve/review:** Preserve merge conflict handling, protected medical provenance and all security
checks. This is a presentation improvement, not a new confirmation step.

**Source:**
src/app/shop/[shopSlug]/divers/[personId]/merge/[survivorId]/MergePreview.tsx:269,386,442

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RR07; queued for implementation or required verification.

- Historical/context: [PR #3059](https://github.com/AaronBuxbaum/diveday/pull/3059) — closed,
partial. Merge email wrapping fixed.

- Historical/context: [PR #3061](https://github.com/AaronBuxbaum/diveday/pull/3061) — closed,
partial. Full-width compared email values; survivor identity by merge action remains.

**Evidence references in local artifact:** `current/diver-merge-preview-light-vw-1280.png`,
`current/diver-merge-preview-light-vw-390.png`

## RR08

**Give rating-only reviews a compact row with readable identity**

**Execution:** Ready to implement. Use compact rating-only rows while raising identity to readable
size and preserving 44px moderation menus and written-review composition.

**Audit assessment (25 October):** still-open. ReviewLedgerRow unchanged; overview current
rating-only rows retain tiny identity and detached menu.

**Remaining observation:** ReviewLedgerRow unchanged; overview current rating-only rows retain tiny
identity and detached menu.

**Audit direction:** Use a compact rating-only row: stars and 44px menu on the top line; readable
diver name below, with trip/date secondary. Keep written reviews in their taller quote/reply
composition and pending/flagged reviews prominent.

**Acceptance:**

- Rating-only, quoted, flagged, hidden and reply-open rows at390 and1280
- Record-identifying name reaches the16px dock-test target
- Menu stays keyboard reachable with44px hit area
- Do not add “Rating only” placeholder text

**Preserve/review:** This is not a blanket reduction of row hit targets or deletion of
publication/moderation history.

**Source:** src/app/shop/[shopSlug]/reviews/_components/ReviewLedgerRow.tsx:75–95,134

**GitHub match:** exact-existing. Exact execution target: issue #3071 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2931](https://github.com/AaronBuxbaum/diveday/issues/2931) — open,
related. Synthetic review capture stability, not rating-only card hierarchy.

- Execution: [Issue #3071](https://github.com/AaronBuxbaum/diveday/issues/3071) — open, exact.
Execution issue #3071 explicitly includes RR08; queued for implementation or required verification.

**Evidence references in local artifact:** `current/staff-reviews-light-vw-1280.png`,
`current/staff-reviews-light-vw-390.png`

## RR09

**Put gear selection before payment review in counter rentals**

**Execution:** Ready to implement. Reorder existing counter-rental sections to Who/When/Gear/review,
keeping sticky total linked to unresolved requirements and explicit charge.

**Audit assessment (25 October):** still-open. Current rental phone still puts selected
items/payment before Gear; only shell width changed.

**Remaining observation:** Current rental phone still puts selected items/payment before Gear; only
shell width changed.

**Audit direction:** Order the main flow as Who, When, Gear, then selected items and payment review.
Keep the existing compact sticky total/Rent out affordance, but make it link or scroll to unresolved
review requirements before committing. Keep cart errors next to their item.

**Acceptance:**

- Select across categories, change dates, remove items and correct prices on390
- No selection loss when moving between sections
- Waiver/certification gates stay above item issuance
- Keyboard order follows visual order

**Preserve/review:** Preserve availability conflicts, verified-card requirements and explicit
payment semantics.

**Source:** src/app/shop/[shopSlug]/gear/rentals/new/page.tsx; _components/CounterRentalPicker.tsx;
CounterRentalCart.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2257](https://github.com/AaronBuxbaum/diveday/issues/2257) — closed,
related. Counter tank gas/nitrox behavior; not Who/When/Gear/payment ordering.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RR09; queued for implementation or required verification.

**Evidence references in local artifact:** `current/counter-rental-form-light-vw-1280.png`,
`current/counter-rental-form-light-vw-390.png`

## RGS01

**Show departure time in command-palette search results**

**Execution:** Ready to implement. Include localized departure time/shop timezone in existing search
result detail. Preserve nearest ranking and tenant scope.

**Audit assessment (25 October):** still-open. Search toResults still formats short date plus site
only; no departure time or zone.

**Remaining observation:** Search toResults still formats short date plus site only; no departure
time or zone.

**Audit direction:** Include localized departure time and shop zone in each trip result detail,
followed by site only when useful. Preserve nearest-to-now ranking.

**Acceptance:**

- Two same-title, same-site departures on one date are distinguishable without opening either
- Check search and recent results at390/1280, long titles, Spanish and midnight boundary

**Preserve/review:** Do not infer time from title or change tenant filtering

**Source:** src/db/search.ts:256; src/components/search/palette-start-rows.tsx:92

**GitHub match:** exact-existing. Exact execution target: issue #3066 (in-progress). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2366](https://github.com/AaronBuxbaum/diveday/issues/2366) — closed,
related. Palette hydration capture, not localized departure time/zone.

- Execution: [Issue #3066](https://github.com/AaronBuxbaum/diveday/issues/3066) — open, exact.
Execution issue #3066 explicitly includes RGS01; implementation is in progress, not verified
complete.

**Evidence references in local artifact:**

## RGS02

**Give the phone search palette an explicit way to close**

**Execution:** Ready to implement. Add explicit standard dialog Close control and suppress
keyboard-only hint prose by pointer capability. Preserve Escape and focus restoration.

**Audit assessment (25 October):** still-open. CommandPalette unchanged and lacks explicit touch
Close control.

**Remaining observation:** CommandPalette unchanged and lacks explicit touch Close control.

**Audit direction:** Add a44px Close control adjoining the search field; retain Escape/backdrop
dismissal and focus restoration. Suppress purely keyboard hints for coarse-pointer presentation
while preserving keyboard support.

**Acceptance:**

- Close from pending, failed, empty and populated results without selecting a record
- With the virtual keyboard open, Close remains visible and returns focus to search opener

**Preserve/review:** Do not remove keyboard semantics or treat viewport width as proof no keyboard
exists

**Source:** src/components/search/CommandPalette.tsx:674; src/components/search/PaletteLegend.tsx:26

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2366](https://github.com/AaronBuxbaum/diveday/issues/2366) — closed,
related. Palette capture reliability; not phone close control.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes RGS02; queued for implementation or required verification.

**Evidence references in local artifact:**

## RGS03

**Make template replacement reviewable before it competes with site editing**

**Execution:** Ready to implement. Owner explicitly approved: Show current-versus-template values
before replacement. Current/incoming value comparison is a new preview capability handling
replacement semantics, beyond the already-authorized moved disclosure.

**Owner decision:** Show current-versus-template values before replacement.

**Audit assessment (25 October):** partially-resolved. Template action moved after main editor into
collapsed briefing-template disclosure; expanded contents still field names/Your edit only, no
current/incoming comparison.

**Remaining observation:** Template action moved after main editor into collapsed briefing-template
disclosure; expanded contents still field names/Your edit only, no current/incoming comparison.

**Audit direction:** Keep template replacement behind its new disclosure after the editor; add
current/incoming field values before its replacement action.

**Acceptance:**

- Review description, depth, conditions and field-guide changes at390/1280
- Unaffected photos/name/routes remain explicitly preserved
- Updated-template, unavailable and undo states remain visible

**Preserve/review:** Do not change template merge/replacement policy as part of layout; two domain
reviews for depth/admission-related wording

**Source:** src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx:242

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RGS03; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Template replacement moved below editor disclosure; current/incoming comparison remains.

**Evidence references in local artifact:** `current/dive-site-edit-light-vw-1280.png`,
`current/dive-site-edit-light-vw-390.png`

## RGS04

**Turn the export manifest into a scannable file index**

**Execution:** Ready to implement. Group existing export manifest into scannable
filename/count/purpose rows with per-file reference disclosure and global caveats. New filename
filtering is held separately as optional complexity.

**Owner decision:** Omit new filename search; existing file-index/disclosure cleanup only.

**Audit assessment (25 October):** still-open. Export page unchanged; current expanded 83-file boxes
still form enormous phone document.

**Remaining observation:** Export page unchanged; current expanded 83-file boxes still form enormous
phone document.

**Audit direction:** Use grouped rows with filename, row count and one-line purpose. Put the full
schema/import caveat under each row disclosure and keep export-wide exclusions together above or
below the index. Provide filename filtering for the83 entries.

**Acceptance:**

- All83 files and their exact counts remain reachable
- Full notes, units, provenance and exclusions remain present and copyable
- Zero-row files remain visible; no silent truncation

**Preserve/review:** The existing outer disclosure and Download export primary are good; preserve
them. Never drop the portability/legal caveats

**Source:** src/app/shop/[shopSlug]/settings/export/page.tsx:135

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes RGS04; queued for implementation or required verification.

**Evidence references in local artifact:** `current/settings-export-file-grid-light-vw-1280.png`,
`current/settings-export-file-grid-light-vw-390.png`

## RGS06

**Name the source field in translation editors**

**Execution:** Ready to implement. Name existing translation input Course summary in Spanish and
colocate with source summary. Preserve unified save/staleness checks.

**Audit assessment (25 October):** partially-resolved. Translation now folded into Spanish section
and one editor save. Summary scope still unnamed and section remains at end, not beside summary;
revise proposal to preserve unified save.

**Remaining observation:** Translation now folded into Spanish section and one editor save. Summary
scope still unnamed and section remains at end, not beside summary; revise proposal to preserve
unified save.

**Audit direction:** Name the field Course summary in Spanish and place it beside the source
summary; preserve the unified editor save and stale-translation checks.

**Acceptance:**

- Translation scope is explicit beside its source summary
- Original changes retain stale-translation notice and refusal
- One unified editor Save remains unambiguous

**Preserve/review:** Do not combine independent save actions or silently publish generated
translation

**Source:** src/app/shop/[shopSlug]/courses/[slug]/edit/page.tsx:84;
src/app/shop/[shopSlug]/courses/[slug]/edit/page.tsx:327;
src/components/assists/TranslationEditor.tsx:80

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RGS06; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Unified translation save; source-field naming/placement remains.

**Evidence references in local artifact:** `current/course-edit-light-vw-1280.png`,
`current/course-edit-light-vw-390.png`

## RGS07

**Group the credential ledger by person and quiet its settled actions**

**Execution:** Verify first. Per-person ledger already shipped. Confirm current reviewed/expired
correction parity and authorization; person-prefilled Add link is safe independently, but do not
invent a re-review workflow from missing control alone.

**Audit assessment (25 October):** partially-resolved. Duplicate flat ledger removed, credential
actions moved into person cards with exceptions at rest. Add still links to global unpreselected
form; reviewed row has no re-review control, so requested correction parity needs investigation.

**Remaining observation:** Duplicate flat ledger removed, credential actions moved into person cards
with exceptions at rest. Add still links to global unpreselected form; reviewed row has no re-review
control, so requested correction parity needs investigation.

**Audit direction:** Keep the per-person credential ledger; preselect person from each Add
credential door and verify reviewed/expired correction parity without adding gates.

**Acceptance:**

- Expired and missing credential warnings stay visible at rest
- Review and correction available equally for current/expired records
- Existing #credentials and #add-credential links land and open the correct context

**Preserve/review:** H-59: a credential clock informs, never gates. Retain authorization and audit
trail. Coordinate with C10 but distinct scope: ledger vs collapsed summaries

**Source:** src/app/shop/[shopSlug]/settings/team/_components/StaffCredentials.tsx:81;
src/app/shop/[shopSlug]/settings/team/page.tsx:633

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RGS07; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
partial. Flat credential ledger replaced with staff cards; person preselection/correction parity
remain.

**Evidence references in local artifact:** `current/settings-team-light-vw-1280.png`,
`current/settings-team-light-vw-390.png`

## RGS08

**Keep signed-record lookup ahead of rarely edited form definitions**

**Execution:** Ready to implement. Place existing signed-record search before rarely edited
versioned form definitions; preserve material-change warnings and direct edit links.

**Audit assessment (25 October):** still-open. Waiver management still precedes signed-record lookup
in current phone and desktop captures.

**Remaining observation:** Waiver management still precedes signed-record lookup in current phone
and desktop captures.

**Audit direction:** Lead with signed-record search and exceptions. Move course form management into
a clearly named disclosure after the records or a secondary Forms view; direct edit links should
open that view.

**Acceptance:**

- A returning staffer can reach signed-record search in the first phone viewport
- Form deep links open the relevant editor
- Resign-impact counts and medical controls remain adjacent to save

**Preserve/review:** Do not merge versioned release and course-form semantics. Preserve precise
document titles and material-change warnings

**Source:** src/app/shop/[shopSlug]/waivers/page.tsx:350

**GitHub match:** exact-existing. Exact execution target: issue #3072 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3072](https://github.com/AaronBuxbaum/diveday/issues/3072) — open, exact.
Execution issue #3072 explicitly includes RGS08; queued for implementation or required verification.

- Historical/context: [PR #3018](https://github.com/AaronBuxbaum/diveday/pull/3018) — closed,
related. Waiver definition columns aligned, not signed-record-first composition.

**Evidence references in local artifact:** `current/staff-waivers-light-vw-1280.png`,
`current/staff-waivers-light-vw-390.png`

## RGS09

**Hide diagnostic JSON behind the support action**

**Execution:** Ready to implement. Disclose raw support JSON while leaving human result, Copy report
and Email support visible. Preserve exact payload and diagnostic caveats.

**Audit assessment (25 October):** still-open. CertCheckTry unchanged; diagnostic raw JSON still
open in normal flow.

**Remaining observation:** CertCheckTry unchanged; diagnostic raw JSON still open in normal flow.

**Audit direction:** Keep the human pass/fail result, Copy report and Email support visible. Put raw
content in View report disclosure so support can inspect/copy exact payload without making operators
read implementation details.

**Acceptance:**

- Failure still says which agency failed and what to do
- Copy report contains identical data before/after layout change
- Raw payload available without network and no diver details added

**Preserve/review:** This is a diagnostic carve-out: preserve truthful sample-only/no-agency-contact
disclosure and exact support payload

**Source:** src/app/shop/[shopSlug]/settings/_components/CertCheckTry.tsx:272

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes RGS09; queued for implementation or required verification.

**Evidence references in local artifact:** `current/settings-cert-checks-light-vw-390.png`,
`current/settings-cert-checks-light-vw-1280.png`

## RP01

**Lead embedded booking success with the confirmation**

**Execution:** Ready to implement. Move existing embedded success confirmation ahead of mobile
briefing while preserving seat/payment/readiness distinctions.

**Audit assessment (25 October):** still-open. Current embedded phone success is 1,927px tall. The
confirmation still follows trip briefing, conditions and What changed, while desktop already shows
it beside the trip heading. Keep the correction scoped to phone ordering.

**Remaining observation:** Current embedded phone success is 1,927px tall. The confirmation still
follows trip briefing, conditions and What changed, while desktop already shows it beside the trip
heading. Keep the correction scoped to phone ordering.

**Audit direction:** After submission, put a compact booked-seat confirmation and readiness CTA
before the briefing. Keep trip identity and date beside success; move supporting briefing below.

**Acceptance:**

- Check embedded and full-page success at390/1280, including long trip titles.
- Focus/announce confirmation after submission; no duplicate booking on refresh or retry.

**Preserve/review:** Preserve payment-versus-seat confirmation distinctions, boarding readiness and
date zone.

**Source:** src/app/s/[shopSlug]/trips/[id]/page.tsx; _components/EmbedBookedNotice.tsx;
_components/BookingSections.tsx

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2432](https://github.com/AaronBuxbaum/diveday/issues/2432) — closed,
related. Embed confirmation fallback name, not confirmation-first composition.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes RP01; queued for implementation or required verification.

**Evidence references in local artifact:** `current/booking-confirmed-embed-light-vw-390.png`,
`current/booking-confirmed-embed-light-vw-1280.png`

## RP02

**Make the doctor referral action open the actual form**

**Execution:** Ready to implement. Make existing official doctor-form link primary and label page
printing truthfully; retain exact medical questions, form version/licensing and domain reviews.

**Audit assessment (25 October):** still-open. Current doctor page still tells the reader to Print
this page and complete the form below, although the actual official examiner page is a link. A
private signed-form upload was added; it does not correct the printing instruction mismatch.

**Remaining observation:** Current doctor page still tells the reader to Print this page and
complete the form below, although the actual official examiner page is a link. A private signed-form
upload was added; it does not correct the printing instruction mismatch.

**Audit direction:** Make Open or download the official doctor form the primary action, with precise
page3 guidance. Label printing this web page as printing instructions/answers. Explain the two
documents plainly.

**Acceptance:**

- Check screen and print instructions against the actual linked official form.
- Keep date-of-birth protection for answers, private delivery and exact document version.
- Test phone and desktop; official form remains accessible if answers are unavailable.

**Preserve/review:** Do not rewrite medical questions or prescribe clearance. Preserve official form
licensing/version and require two differently framed domain reviews; security review if
private-answer access changes.

**Source:** src/app/waivers/[token]/doctor/page.tsx; src/i18n/locales/en-US/diver.json:1176

**GitHub match:** exact-existing. Exact execution target: issue #3074 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2793](https://github.com/AaronBuxbaum/diveday/issues/2793) — closed,
related. Official examiner form/transcription policy; reviewed closed issue does not require direct
PDF primary action.

- Historical/context: [Issue #2797](https://github.com/AaronBuxbaum/diveday/issues/2797) — closed,
related. Private return upload; not official-form action and print-instructions labels.

- Execution: [Issue #3074](https://github.com/AaronBuxbaum/diveday/issues/3074) — open, exact.
Execution issue #3074 explicitly includes RP02; queued for implementation or required verification.

**Evidence references in local artifact:** `current/waiver-doctor-light-vw-390.png`,
`current/waiver-doctor-light-vw-1280.png`

## RP03

**Make unresolved medical review the next action after signing**

**Execution:** Ready to implement. Move existing precise held-medical next step ahead of general
prep CTA; branch shop review versus actual doctor referral. No screening changes.

**Audit assessment (25 October):** still-open. Current medical-held success still leads with Waiver
received and gives the general prep link primary emphasis while Take this to your doctor remains
secondary. The open Medical step and 3 of 4 count correctly avoid claiming completion and must be
preserved.

**Remaining observation:** Current medical-held success still leads with Waiver received and gives
the general prep link primary emphasis while Take this to your doctor remains secondary. The open
Medical step and 3 of 4 count correctly avoid claiming completion and must be preserved.

**Audit direction:** Keep receipt confirmation, then immediately state the precise outstanding
medical status and its next action. Give doctor/referral guidance primary emphasis only where that
is actually required; otherwise lead with shop review/contact. Move general trip-prep CTA below.

**Acceptance:**

- Compare fully complete, referral-required, shop-review-needed and guardian states.
- No success styling or wording implies medically cleared while review is outstanding.
- Preserve receipt, legal signature and safe contact instructions.

**Preserve/review:** Do not equate all held states with physician referral. No change to screening
or boarding rules; two domain reviews.

**Source:** src/app/waivers/[token] success state; diver waiver copy bundle

**GitHub match:** exact-existing. Exact execution target: issue #3074 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2065](https://github.com/AaronBuxbaum/diveday/issues/2065) — closed,
related. Staff readiness wording about medical referral, not post-signing next-action hierarchy.

- Historical/context: [Issue #2797](https://github.com/AaronBuxbaum/diveday/issues/2797) — closed,
related. Private signed-form return; retain distinctions between referral and shop review.

- Execution: [Issue #3074](https://github.com/AaronBuxbaum/diveday/issues/3074) — open, exact.
Execution issue #3074 explicitly includes RP03; queued for implementation or required verification.

**Evidence references in local artifact:** `current/waiver-medical-held-light-vw-390.png`,
`current/waiver-medical-held-light-vw-1280.png`

## RP04

**Only ask certification details when the diver has a certification**

**Execution:** Ready to implement. Condition certification detail controls on existing certified
agency selection, preserve values when switched back; do not infer verification.

**Audit assessment (25 October):** still-open. Current register capture still shows Level and Card
number immediately under Agency: Not certified yet. The fields remain unconditional.

**Remaining observation:** Current register capture still shows Level and Card number immediately
under Agency: Not certified yet. The fields remain unconditional.

**Audit direction:** When Not certified yet is selected, show a concise explicit uncertified state.
Reveal agency-appropriate level and optional card number after an agency is chosen, preserving edits
if the user changes their selection back.

**Acceptance:**

- Test uncertified and every supported agency, with validation errors and backtracking.
- An uncertified submission never creates a certification from stale hidden values.
- Accessible disclosure and no-JavaScript fallback remain usable.

**Preserve/review:** Self-declared details never become verified evidence or automatic boarding
clearance; domain review.

**Source:** src/app/s/[shopSlug]/register/RegisterForm.tsx:119

**GitHub match:** exact-existing. Exact execution target: issue #3074 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2130](https://github.com/AaronBuxbaum/diveday/issues/2130) — closed,
related. Supported agencies in registration; not conditional uncertified fields.

- Execution: [Issue #3074](https://github.com/AaronBuxbaum/diveday/issues/3074) — open, exact.
Execution issue #3074 explicitly includes RP04; queued for implementation or required verification.

**Evidence references in local artifact:** `current/shopfront-register-light-vw-390.png`,
`current/shopfront-register-light-vw-1280.png`

## RP05

**Present second-factor authentication as a normal next step**

**Execution:** Ready to implement. Present ordinary second-factor challenge neutrally with clear
recovery option; retain actual error styling for incorrect submissions and auth checks.

**Audit assessment (25 October):** still-open. Current ordinary second-factor challenge remains a
red error under the credential form, with authenticator/recovery helper copy sharing the field label
line.

**Remaining observation:** Current ordinary second-factor challenge remains a red error under the
credential form, with authenticator/recovery helper copy sharing the field label line.

**Audit direction:** Use a neutral next-step heading and focused code field. Separate helper copy
from the label; keep a clear recovery-code option and back action. Reserve error treatment for an
actual incorrect/expired submission.

**Acceptance:**

- Cover authenticator and recovery codes, incorrect/expired code, rate limit and back navigation.
- Keyboard focus enters the challenge; credentials are not exposed or unnecessarily re-entered.

**Preserve/review:** Preserve authentication/session behavior, generic privacy-safe errors and
security review for any auth-state changes.

**Source:** src/app/sign-in/page.tsx; src/i18n/locales/en-US/diver.json:3344

**GitHub match:** exact-existing. Exact execution target: issue #3070 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3070](https://github.com/AaronBuxbaum/diveday/issues/3070) — open, exact.
Execution issue #3070 explicitly includes RP05; queued for implementation or required verification.

**Evidence references in local artifact:** `current/sign-in-second-factor-light-vw-390.png`,
`current/sign-in-second-factor-light-vw-1280.png`

## RP06

**Surface unclaimed group seats beside the organizer confirmation**

**Execution:** Ready to implement. Expose existing organizer-authorized group seat summary and jump
near confirmation; no new claim authority or cross-adult medical disclosure.

**Audit assessment (25 October):** still-open. Current organizer confirmation remains personal-only;
the unclaimed seat is in Your group’s seats below personal preparation, arrival and What changed.
The full current phone capture is 3,564px tall.

**Remaining observation:** Current organizer confirmation remains personal-only; the unclaimed seat
is in Your group’s seats below personal preparation, arrival and What changed. The full current
phone capture is 3,564px tall.

**Audit direction:** Add a compact group summary beside confirmation, such as2seats ·1not claimed,
with a direct jump to the existing group section. Consider placing that section immediately after
the personal checklist.

**Acceptance:**

- Check1/2/large parties, fully claimed and partially claimed groups.
- One tap reaches the correct held seat and invite link.
- Counts remain accurate after claim/cancellation.

**Preserve/review:** Expose only organizer-authorized claim/readiness summaries; preserve adult
privacy, guardian flows and payment ownership.

**Source:** src/app/ready/[token]/_components/PartySection.tsx; ready page composition

**GitHub match:** exact-existing. Exact execution target: issue #3074 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Execution: [Issue #3074](https://github.com/AaronBuxbaum/diveday/issues/3074) — open, exact.
Execution issue #3074 explicitly includes RP06; queued for implementation or required verification.

**Evidence references in local artifact:** `current/party-organizer-confirmation-light-vw-390.png`,
`current/party-organizer-confirmation-light-vw-1280.png`

## RP07

**Avoid asking for the shop name again after setup was sent**

**Execution:** Already done. Artifact assessment marks resolved and current source is unchanged:
Current phone and desktop success explicitly say the request was sent and now explain the optional
field: “We use it to name your demo.” The original missing-purpose ambiguity is resolved while
retaining H-131’s optional personalization.

**Audit assessment (25 October):** resolved. Current phone and desktop success explicitly say the
request was sent and now explain the optional field: “We use it to name your demo.” The original
missing-purpose ambiguity is resolved while retaining H-131’s optional personalization.

**Remaining observation:** Current phone and desktop success explicitly say the request was sent and
now explain the optional field: “We use it to name your demo.” The original missing-purpose
ambiguity is resolved while retaining H-131’s optional personalization.

**Audit direction:** No new issue from this historical proposal. Preserve the implemented behavior
described in the current assessment.

**Acceptance:**


**Preserve/review:** Do not expose contact data in URLs or persist sensitive form fields for demo
personalization.

**Source:** src/app/get-set-up success page and demo personalization form

**GitHub match:** resolved-existing. Exact historical completion is supported by audit assessment
and PR scope.

- Historical/context: [PR #3027](https://github.com/AaronBuxbaum/diveday/pull/3027) — closed, exact.
Setup-success wording explains optional demo personalization; audit resolves.

**Evidence references in local artifact:** `current/get-set-up-sent-light-vw-390.png`,
`current/get-set-up-sent-light-vw-1280.png`

## RP08

**Separate switching guidance from the full import reference**

**Execution:** Ready to implement. Disclose detailed import mapping after concise first steps and
add plain in-page contents; preserve complete mapping and unsupported-data caveats.

**Audit assessment (25 October):** still-open. Current spreadsheet guide is 9,753px tall on phone.
The lengthy column definitions remain fully expanded within the migration steps, without a contents
list or field-reference disclosure. EVE, FareHarbor and Rezdy retain the same extended guide
pattern.

**Remaining observation:** Current spreadsheet guide is 9,753px tall on phone. The lengthy column
definitions remain fully expanded within the migration steps, without a contents list or
field-reference disclosure. EVE, FareHarbor and Rezdy retain the same extended guide pattern.

**Audit direction:** Keep the migration decision and first steps short, then provide an in-page
contents list and a clearly named expandable field reference. Group columns by identity,
certifications, kit and history; preserve a copyable complete mapping and direct links to it.

**Acceptance:**

- Review spreadsheet, EVE, FareHarbor and Rezdy at390/1280.
- All mappings, import exclusions and provenance remain available and linked.
- Demo/setup CTA remains contextual; reader can jump directly to their field question.

**Preserve/review:** Do not remove migration caveats or imply unsupported bookings/payments/medical
data imports.

**Source:** src/app/switching and shared switching guide components

**GitHub match:** exact-existing. Exact execution target: issue #3069 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2200](https://github.com/AaronBuxbaum/diveday/issues/2200) — closed,
related. Corrected migration wording; not short guidance and expandable field reference.

- Execution: [Issue #3069](https://github.com/AaronBuxbaum/diveday/issues/3069) — open, exact.
Execution issue #3069 explicitly includes RP08; queued for implementation or required verification.

**Evidence references in local artifact:** `current/switching-spreadsheet-light-vw-390.png`,
`current/switching-spreadsheet-light-vw-1280.png`

## RP09

**Lead the weekly digest with unresolved operational work**

**Execution:** Ready to implement. Promote existing unresolved roll-call summary above weekly
reporting; retain timestamp/context that digest is not live emergency truth.

**Audit assessment (25 October):** still-open. Current digest still lists two open roll calls below
Last week, Money, This week and Waivers. Its unresolved-work order is unchanged.

**Remaining observation:** Current digest still lists two open roll calls below Last week, Money,
This week and Waivers. Its unresolved-work order is unchanged.

**Audit direction:** When unresolved roll calls exist, place a compact Needs attention summary at
the top with an Open Today link. Keep weekly reporting below, and avoid a large generic alert when
there is no open work.

**Acceptance:**

- Compare no-open-work, open-roll-call and multiple-other-exception emails at phone/desktop widths.
- Counts and data timestamp remain accurate for the send; link opens live current status.

**Preserve/review:** A weekly digest is not an emergency alert or current live truth; preserve
existing alerting and safety processes, domain review.

**Source:** src/lib/notifications/weekly-digest-email.ts

**GitHub match:** exact-existing. Exact execution target: issue #3073 (queued). Historical or
partial references below remain context and are not automatic closure targets.

- Historical/context: [Issue #2489](https://github.com/AaronBuxbaum/diveday/issues/2489) — closed,
related. Digest unused forecast cleanup; not unresolved operational-work summary.

- Execution: [Issue #3073](https://github.com/AaronBuxbaum/diveday/issues/3073) — open, exact.
Execution issue #3073 explicitly includes RP09; queued for implementation or required verification.

**Evidence references in local artifact:** `current/weekly-digest-email-light-vw-390.png`,
`current/weekly-digest-email-light-vw-1280.png`
