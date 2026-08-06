# 20260806-export-operational-records — What "your data is yours" includes, for the records DiveDay writes *about* a shop

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

The full-shop export (ADR 20260722-full-shop-export) has always carried what a shop *entered*: its
divers, trips, bookings, cards, waivers, sites, courses, orders. What it did not carry is the
second category — the records DiveDay writes as a shop works, *about* that work. Staff notes. The
activity trail. Whether a message actually reached a diver. Checkout attempts. Promo redemptions.
Course leads.

Every one of those was on a deliberate exclusion list with a one-line reason, and the reasons were
of two very different qualities. Some were real ("credentials are never exported"). Others were
placeholders that had hardened into policy by sitting still: `internal_notes` was excluded as
"deliberately not portable in this first slice" — a punt, not a principle — and
`shop_promo_redemptions` because "Stripe holds the authoritative count", the exact argument
[20260803-booking-payment-events](20260803-booking-payment-events.md) had already rejected for
payment history, whose whole reason for existing is to stop depending on Stripe for a shop's own
past. That record deferred the multi-table question explicitly: "the portability decision DATA-A10
tracks covers several tables at once and is not this record's to make." This is that record.

The reasons also lived in the wrong place. `src/db/export.test.ts`'s coverage guard forces every
schema table into exported / folded / excluded, which is why none of this drifted silently — but a
comment in a test is not where a shop owner reads why their notes are missing. The bundle README and
the export settings page are, and by 2026-08-06 the page's own "not included" line had gone stale
enough to be actively misleading.

## Decision

**A record DiveDay writes about a shop's work belongs to that shop, unless carrying it would be a
credential, a pointer into infrastructure the destination cannot reach, or DiveDay's own bookkeeping
about its own machinery.** Applying that, seven files join the bundle:

| File | Why it is the shop's |
| --- | --- |
| `internal_notes.csv` | The shop's own words about its own customers. Never shown to a diver, never part of a gate. |
| `activity_events.csv` | Who did what, to which departure, when. Append-only, so it reconstructs how a trip reached the state the other files describe. |
| `notification_deliveries.csv` | "Did this diver ever get their waiver request" is a question a shop must be able to answer about its own past, sometimes years later, and no other file could. |
| `booking_checkouts.csv` | What the shop *asked for*, including the asks nobody finished. `bookings.csv` and `orders.csv` structurally cannot show an abandoned attempt. |
| `booking_checkout_bookings.csv` | Which seats each attempt covered, and the per-seat gear charge, which lives nowhere else. |
| `shop_promo_redemptions.csv` | How a code actually performed. Resolvable at last, because the checkout each row points at now travels with it. |
| `course_inquiries.csv` | Leads someone gave *the shop*. An unconverted lead is exactly the thing a shop would lose by leaving. |

**Two families stay out, and the reasons are now stated where a human reads them** — the bundle
README's "Not included" list and the export settings page — rather than only in a test comment:

- **`processor_erasure_obligations`.** Deliberate, and the sharper of the two. Every row is a
  pointer into *this* Stripe account plus the state of work being done there, so it is unusable in
  another system — but the real reason is
  [20260803-processor-erasure-obligations](20260803-processor-erasure-obligations.md)'s: an
  outstanding obligation is the shop's own compliance state, and an obligation carried into a system
  that cannot discharge it would read as *done*. Shipping it would make an incomplete erasure look
  complete.
- **`day_closeouts`.** A narrower argument: a close-out is an attestation over a day whose every
  underlying fact — the roll call, the blockers, the departures — is already in the bundle. The row
  adds a signature over records the destination has and nothing it lacks. Revisit if the attestation
  ever becomes evidence in its own right.

The retry queues, per-attempt logs, rate-limit state, push credentials, blowout cascade state, and
DiveDay's own reconciliation ledgers (payment-operation intents, the Stripe webhook ledger,
media-deletion attempts) stay out under the third clause: plumbing and bookkeeping, not records.

Column-level exclusions follow the precedents already in the bundle: `stripe_account_id` is provider
linkage (as on `orders`/`tips`), `checkout_url` is an ephemeral link that stopped resolving when the
session expired (as `tips.checkout_url`), and a join row's surrogate id is dropped where the pair it
joins is exported (as `buddy_pair_members.id`).

## Alternatives considered

- **Write the exclusions down and export nothing new.** The review's own framing offered this as an
  equal option ("extend the export or write the exclusions down"), and it is cheaper and safer: no
  new personal data in the bundle at all. Rejected because writing down "your private notes about
  your own customers are not portable" makes the gap official rather than closing it, and the wedge
  the export exists to drive is *"switching is safe"* — a promise that gets weaker every time the
  answer to "is X included?" is no.
- **Export everything and exclude nothing.** Simplest rule, no judgement calls, no list to maintain.
  Rejected on `processor_erasure_obligations` alone: exporting an undischargeable compliance
  obligation is worse than omitting it, because it reads as discharged. Once one exclusion is
  principled the list has to exist, and the retry queues and credentials were never candidates.
- **Fold the checkout attempts into `bookings.csv` rather than giving them their own files.** Fewer
  files, and every checkout does relate to seats. Rejected because the relationship is
  many-to-many — one attempt covers a party — so folding either duplicates the attempt per seat or
  loses the per-seat gear charge, and `order_line_items.csv` already set the precedent for a child
  file.
- **Export `day_closeouts` too, for symmetry with the other append-only trails.** Tempting, and the
  cost is one more file. Rejected for now because it is genuinely derivative — see above — and a
  bundle that carries a signature over facts it already carries invites a reader to treat the
  signature as the record. Named here rather than dropped, so the next reader knows it was weighed.

## Consequences

- **The bundle now carries substantially more personal data**, including free-text staff notes about
  named divers and every message-delivery outcome. It was already the roster's medical evidence, so
  the gate is unchanged (owner/manager, re-checked against the database rather than the session's
  JWT) — but the blast radius of a leaked bundle grew, and the export page says so plainly.
- **Erasure and export now have to agree**, and that agreement is enforced rather than asserted.
  `anonymize.ts` sweeps every one of the seven, but a future table exported without a sweep would
  hand a diver's details back out through the bundle, and until 2026-08-06 nothing would have said
  so: the export coverage test forces a table into exported/folded/excluded and stops there, and
  `delete-path-coverage.test.ts` — despite the name — guards demo-shop teardown, not erasure
  (found by the security review of this change). `export.test.ts`'s "keeps an erased diver out of
  every file" now erases a diver who has notes, a lead, an activity row and contact details, then
  asserts no *file in the bundle* carries any of them — written whole-bundle rather than per file
  so a future export file inherits the guard for free.
- **One erasure gap closed on the way in.** `internal_notes` was swept only on the note's subject
  (`person_id`), so a note filed under diver A that named diver B survived B's erasure verbatim.
  Harmless while notes never left the shop, and not harmless once `internal_notes.csv` carries them
  out of it — `anonymize.ts` now also redacts note bodies by word-boundary name match, the same
  handle and the same accepted over-reach `activity_events.message` already used, logged under
  `internal_note_name`.
- **`course_inquiries.csv` was empty on every demo** until this change, because nothing seeded a
  lead. `src/db/seed-course-inquiries.ts` now seeds three, one per `person_id` state — linked,
  unlinked-with-an-address, and unlinked-with-no-address — which is also the first visible fixture
  for the residue [20260802-diver-data-erasure](20260802-diver-data-erasure.md) records: a lead with
  no email can never be reached by an erasure that starts from one.
- **It does not add an importer.** These files round-trip nothing; `src/db/import.ts` still reads
  contacts only. Portability here means "you leave with your history", not "you can put it back".
- **It does not decide retention.** How long these trails are kept is
  [20260803-append-only-retention](20260803-append-only-retention.md)'s `RETENTION_DAYS`, and a
  pruned row is simply absent from a later bundle.
- **The two exclusions are now claims a reader can check**, which means they can also be wrong in
  public. That is the intended trade: an export that is quiet about its gaps is how migrations lose
  data.
