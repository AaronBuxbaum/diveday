# Collection-pattern audit

Source audit for issue #2877, 2026-10-21. It covered staff collection families under `src/app`,
shared UI/editor components, feature modules and public/diver routes. Browser verification and
visual review cover the changed routes; this is not a visual inspection of every route.

## Confirmed inconsistencies corrected

| Surface | Before | Shared pattern |
| --- | --- | --- |
| Boats | Every hull permanently showed its whole edit form; a nested list and dashed add panel drew separate geometry | Readable names, seat counts and paper facts in `DisclosureRowList`; per-hull form and add on intent |
| Emergency reference | Five numbered label/phone input pairs obscured the configured contact list | Named contacts and numbers in disclosure rows, one next-slot Add contact, separate response/alert groups in the existing single save |
| Trip tags | Every tag showed a rename input, Save and Delete; separate dashed add panel | Readable name rows with disclosed rename/delete and one final add row |
| Dive packages | Individually bordered tiles and a permanent five-field creation form | `LedgerRow` records with saved terms and supported delete; disclosed create and explicit empty state |
| Pre-departure checklist | Individually bordered tiles and permanent add form | Ordered `LedgerRow` records retaining reorder/delete; disclosed add |

The existing `DisclosureRow` gained optional saved-value and initial-open slots. Existing callers
retain their shape. The obsolete settings `AddPanel` and its geometry-pinning test were removed.
[Forms and controls](forms-and-controls.md#small-collection-editors-readable-rows-forms-on-intent)
records the shared grammar.

## Deliberate differences retained

| Family | Why it keeps its composition |
| --- | --- |
| Courses, sites, divers, gear, orders, discounts and staffing | Already use shared ledgers, row navigation or disclosed editing; long record editors retain their document layout |
| Settings hub and team | Existing settings rows/inset groups and disclosed role/contact controls are the precedent |
| Profile, dock-day rhythm and rentals | Singleton settings or a fixed catalog matrix with one approved save, rather than independently added records |
| Billing, connections, security, calendar, import/export and backups | Connection, credential, action or status workflows rather than arbitrary object CRUD |
| Requests, reviews and inbox | Disposition and responsibility queues; the notes for Claude at the foot of the Inbox are one box, not a collection |
| Lost-and-found | Shared object rows; creation belongs to the departure that found the item |
| Waiver/course forms | Versioned legal editors retain their impact warnings and existing disclosed edit/add |
| FAQs, day-by-day, site landmarks and field guides | Unsaved repeating fields inside one parent document save |
| Photo collections and map route points | Image upload and spatial editing require their own direct manipulation |
| Manifest, roll call, prep, reports and retained logs | Operational tasks and evidentiary records carry context absent from configuration CRUD |
| Public, marketing, onboarding and token pages | Browsing, checkout or consent flows rather than administrative collection editing |
| Feature modules | Backend integration/export/calendar/recap modules have no independent collection-management surface |

No package rename or checklist rename operation was introduced. Purchased package snapshots,
authorization, boat admission limits, checklist order and emergency/offline readers remain domain
contracts. Closed emergency rows remain mounted and submit their current values, and shore-alert
consent retains its separate recorded-address and confirmation rules.

## Manual Settings follow-up

A later interactive pass on 2026-10-21 opened and exercised all 25 Settings destinations on
merged PR #2886. It is separate from the source audit above and that PR's original CI and visual
verification. Supported safe edits and refusal paths were exercised; unavailable connection and
credential controls were inspected in their existing states.

| Destinations | Pages opened and exercised |
| --- | --- |
| 1–5 | Settings hub; Shop profile & branding; Dock-day rhythm; Rentals; Features |
| 6–10 | Team; Activity; Emergency reference; Email; Security |
| 11–15 | Calendar; WhatsApp; Billing; Bookkeeper's email; Export |
| 16–20 | Backups; Import; Integrations; Website embed; Boats |
| 21–25 | Trip tags; Pre-departure checklist; Dive packages; Dive sites; Waivers and signed records |

The pass confirmed five pre-existing defects: boat draft loss after refusal
([#2898](https://github.com/AaronBuxbaum/diveday/issues/2898)), Bookkeeper Save beside the helper
([#2899](https://github.com/AaronBuxbaum/diveday/issues/2899)), stale dive-site input after Clear
([#2900](https://github.com/AaronBuxbaum/diveday/issues/2900)), waiver All retaining the medical
filter ([#2901](https://github.com/AaronBuxbaum/diveday/issues/2901)), and redundant encoding on
function-action import forms ([#2902](https://github.com/AaronBuxbaum/diveday/issues/2902)). Their
source fixes and regression tests are prepared; runtime validation of those fixes is **unrun**.
The original PR's passing checks do not validate this later patch.

The pass did not complete provider connections, payments, credential creation, legal publication
or signing, external messages or backup delivery. Contact import stopped at preview; no import
was committed. Export feedback appeared, but successful file receipt remains unverified. External
iframe preview content was blocked in the local environment. Reversible preferences were
restored, and disposable collection records were removed through their normal soft-delete flows.
