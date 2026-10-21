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
| Requests, reviews, inbox and saved answers | Disposition and responsibility queues; saved answers are created from the answer being sent |
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
