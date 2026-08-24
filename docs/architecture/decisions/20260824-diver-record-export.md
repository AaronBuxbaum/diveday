# 20260824-diver-record-export — A per-diver export answers "what do you hold about me", scoped to the diver's own rows and staff attribution only

- **Status:** Accepted
- **Date:** 2026-08-24
- **Issue:** [726](https://github.com/AaronBuxbaum/diveday/issues/726)

## Context

`anonymizeDiver` (`src/db/anonymize.ts`, ADR 20260802-diver-data-erasure) is thorough about the
destructive half of a diver's data rights: owner-only, deliberately stricter than `canDeleteDiver`,
and it even tracks what the payment processor still owes after erasure
(`processor_erasure_obligations`, ADR 20260803-processor-erasure-obligations). The constructive
half did not exist. `loadShopExportBundleInput` (ADR 20260722-full-shop-export) is the only export,
and it is the whole shop — every diver's name, email, phone, date of birth, emergency contact,
dive insurance, certifications, waiver history, bookings, payments, prior visits, rental fit and
photos, as CSVs plus media.

So a shop answering one diver's "what do you hold about me" — a real request under GDPR Article
15, and the equivalents a Florida shop's international customers bring with them — had exactly one
tool: export everybody and pick through it by hand. That is worse than no tool. It produces a file
containing several hundred other people's personal and medical-adjacent data sitting on a laptop,
so satisfying one person's rights manufactures a breach risk for everyone else on the roster.

## Decision

**A second loader, `loadDiverExportBundleInput` (`src/db/export.ts`), scoped to one `person_id` —
a where-clause and a smaller bundle over the same tables, not a second exporter.** Every query in
it is scoped to `shopId` *and* to this `personId` (or to a booking/order/review id already proven
to belong to them); there is no query that reads a table by `shopId` alone. Same gate as the shop
export, `canPersonExportShopData` (owner/manager, re-checked against the database), reached from
the diver's own record page and downloaded through `divers/[personId]/export/route.ts`.

**Every shared-row question got a decision, not a default**, because a bundle that leaks another
diver's name is the exact failure this feature exists to prevent:

- **`party_lead_booking_id`** points at a different diver's booking row. It carries no name on its
  own, but it is a foreign key this diver has no reason to hold, so `bookings.csv` blanks it rather
  than exporting it.
- **A buddy team's other members** live as separate rows in `buddy_pair_members`, keyed by a
  different `booking_id`/`crew_person_id`. Filtering to this diver's own bookings (and their own
  `crew_person_id`, if they are also staff) naturally selects only their own membership row per
  team — never another member's — so `buddy_pairs.csv` needed no redaction, only the right
  `where`.
- **Staff attribution** — who recorded a roll call, moderated a review, created an order, paired a
  team — travels by name. The shop's own record of who did what is the shop's, not a third
  party's, the same rule the whole-shop bundle already applies to itself.
- **`internal_notes`** is excluded outright. Its own note in the shop bundle already says why —
  "Never shown to a diver, and never part of any gate" — and its `body` is free text that can name
  a *different* diver (`anonymizeDiver`'s own erasure sweep needs a word-boundary regex over
  exactly this column for exactly this reason).
- **`activity_events`** is excluded outright for the same reason at larger scale. Its `message` is
  English prose generated at write time that routinely interpolates a full name, often someone
  else's, on a shared booking or a roll-call line (`"${actor.name} checked in ${diver.name}"`).
  Safely redacting it needs the same name-matching sweep the erasure path uses; replicating that
  correctly here is a follow-up, not something to improvise under a security-sensitive diff.
- **`booking_checkouts`** is excluded outright. One checkout attempt can cover an entire party
  sharing a single Stripe session, so `customer_email` may belong to whoever submitted the payment
  rather than this diver, and the totals are the party's, not theirs.
  `booking_checkout_bookings.csv` — the per-seat line within a checkout — carries none of that
  risk (already one row per person) and is included.
- **Shop-wide configuration** (the trip catalog, the course catalog, dive sites, the gear fleet,
  promo codes) never named this diver and is out of scope by construction.
- **`orders.description` and `order_line_items.description`** are staff-typed free text on the
  invoice form, the same shape as `internal_notes.body` and `activity_events.message` — found in
  security review, not in the first pass. Dropped from `orders.csv`/`order_line_items.csv` for the
  same reason; every other column, including the amounts, ships.
- **An imported waiver's re-stored source documents** split the same way `medical_answers` does:
  `importSourceDocumentUrl` (the general signed release) is bundled, `importSourceMedicalDocumentUrl`
  (a scanned intake form) is not — found in security review, where the JSON column was correctly
  withheld but the equivalent scanned document was not.

**Medical answers on a signed waiver are withheld, deliberately unresolved rather than defaulted.**
The incident export withholds them because its reader is an investigator (H-03's boundary); a
subject-access request's reader is the person who wrote them, so that argument reverses — but
which way it should land is a legal question, not an engineering default, and it is recorded as
H-50 in `docs/product/human-decisions.md` rather than decided here. Every other field of the
diver's own signed evidence — status, signature, method, timestamps, the exact template text —
ships now.

**One file, `waiver_templates.csv`, is new relative to the shop bundle's shape**: the exact wording
of every release version this diver actually signed, resolved from their own `waiver_records`
rows. It is safe by construction (template text is shop configuration, never another diver's data)
and it is the diver's own contract, which the shop bundle has no equivalent reason to single out
per-person.

## Alternatives considered

**A `?person=` filter on the existing shop exporter.** Rejected: the shop loader's column set is
the whole-shop contract (`EXPORT_FILE_NOTES`, a sync test against it), and quietly narrowing rows
without narrowing columns is exactly how `party_lead_booking_id`, `internal_notes` and
`activity_events` would have leaked through unnoticed. A dedicated loader makes every column a
choice instead of an inheritance.

**Deciding the medical-answers question here.** Rejected on the same grounds H-01/H-03 already
stand on for every other waiver-content question — jurisdiction, wording, and now scope, are legal
calls with an engagement already scoped for them (`docs/product/stakeholders/legal-engagement-scope.md`).
Shipping the rest now and recording the open question is more useful than blocking the whole
feature on one field.

**A diver-initiated self-service export.** Rejected outright, not deferred. The shop is the
controller; the request properly goes to them. A public endpoint that emits a person's medical
history to whoever types a matching email address is the wrong shape regardless of scope
questions — it is a different security posture than a staff-gated download, not a smaller version
of it.

## Consequences

- A per-diver export exists for exactly the request that arrives first, without forcing a shop to
  hand over the rest of its roster to satisfy it.
- The next table added to the shop-wide bundle is not automatically safe to add here: whoever adds
  it must ask the same three questions — does it name a diver at all, can a shared row name a
  *different* diver, and can a free-text column carry one — the way this decision asked them for
  every table above `internal_notes.csv` and `activity_events.csv`, or accept its own security
  review.
- H-50 stays open until legal review answers it. Until then, `waiver_records.csv`'s `medical_answers`
  column is absent from both the header and the README's own accounting of what's included — a
  diver reading their own export sees that the gap is stated, not silent.
- The `orders.description` gap and the medical-document leak through `photoUrls` were both found by
  a `security-reviewer` pass before merge, not by the first design pass — proof that the "same three
  questions" discipline above needs the second read as much as it needs the first. Both are fixed in
  the version this ADR describes and covered by regression tests
  (`src/db/diver-export.test.ts`) that build the exact fixture each gap needed to be visible in.
