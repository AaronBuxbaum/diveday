# 20260802-diver-data-erasure — Erase a diver by anonymizing, and re-seal their releases under integrity v2

- **Status:** Proposed
- **Date:** 2026-08-02
- **Supersedes in part:** [20260719-crud-archive-semantics](20260719-crud-archive-semantics.md)
  (the diver bullet only — see "Relationship to the archive and retention ADRs")

## Context

`deleteDiver` sets exactly one column, `people.deleted_at`. Nothing else is touched, ever: name,
email, phone, date of birth, emergency contact, dive insurance, agency card numbers, photographs of
card and diver, and every signed medical questionnaire persist indefinitely. There is no erasure
path in the product at all — a diver who asks a shop to delete what it holds about them cannot be
served, and a shop with a GDPR/CCPA obligation has nothing to point at. This is finding **DATA-H1**.

Two constraints pull against each other:

1. A signed release is **immutable legal evidence**
   ([20260718-waiver-signature-retention](20260718-waiver-signature-retention.md),
   [20260721-waiver-sign-once](20260721-waiver-sign-once.md), whose retention model "must not be
   weakened"). Deleting the record destroys the shop's proof that a diver accepted the release.
2. `waiverIntegrityMetadata` (`src/lib/waiver-integrity.ts`) HMACs a field set that **includes
   `signedName` and `medicalAnswers`**. So stripping the medical answers flips
   `verifyWaiverIntegrity` from `valid` to `invalid` on every erased record — the Signatures tab
   would light up as if the shop's evidence had been tampered with. As the code stood, "strip
   medical" and "preserve verifiable signed evidence" were mutually exclusive.

There is no prior ADR anywhere in this repo on retention periods, subject erasure, or GDPR/CCPA.
This record establishes the mechanism only; **when** a shop may point it at a real diver is
blocked on HD-10/HD-11 (counsel's view on erasure versus signed evidence).

## Decision

Add a second, distinct removal operation: **anonymize and keep** (`anonymizeDiver`,
`src/db/anonymize.ts`). It destroys identity and medical content across the shop's tables and
preserves the *evidence skeleton* of every signed release — timestamps, template snapshot, trip
linkage, signature method, attesting staff member, and a seal.

### Resolving the HMAC conflict: integrity version 2

`waiver_records.integrity_version` was already on the schema and always `1`; it now means
something. A record is verified against **the version it declares**, never against a guess:

- **Version 1** — a signed release as captured, including `signed_name` and `medical_answers`.
  Unchanged; every existing record keeps its seal and its meaning.
- **Version 2** — the erasure-survivor field set: id, shop, booking, person, template
  id/title/version/body, status, signature method, `recorded_by_person_id`, `consented_at`,
  `signed_at`, `medical_review_required`, `completed_at`, `created_at`, plus `anonymized_at` and
  `anonymized_by_person_id`. Computed at erasure time and written in the same transaction as the
  strip.

The v2 metadata carries an explicit `version: 2` key. That is domain separation, not decoration: an
imported record can legitimately have no signed name and no medical answers, which is exactly the
case where a v1 digest could otherwise collide with a v2 one over the same row. A version this
build does not recognize reads as `invalid`, never as valid — a seal that cannot be checked must
not present itself as checked.

`medical_review_required` deliberately **survives**. It is a medical assertion, but `status`
(which must survive) already encodes it, so stripping it would erase nothing `status` does not
reveal while leaving a `medical_review` row that contradicts itself.

The erasure stamp is *inside* the seal rather than an annotation beside it, so back-dating who
erased a record, or by whom, is itself detectable as tampering.

**Be clear about the cost.** Anonymization is one-way and evidence-reducing. After it runs, nobody
— not the shop, not the diver, not a court — can verify the pre-erasure content of that release.
The v2 seal proves only that the surviving skeleton has not drifted since erasure; it says nothing
about what the signer's name or medical answers were. That is inherent to erasure, not an artefact
of this design, and it is precisely why the action is owner-gated, confirmation-gated, and
irreversible by construction.

### One way, structurally

`people.anonymized_at` is a separate column from `deleted_at`, and a check constraint
(`people_anonymized_stays_removed`) requires that an erased row stay removed. `restoreDiver` — a
live product feature with an undo affordance on the roster — refuses an erased record explicitly,
and the database refuses it again if a future caller forgets. An erased diver can never re-enter
the active roster half-blank.

### Authorization

Stricter than `canDeleteDiver` (owner **or** manager): erasure is **owner only**
(`canErasePersonalData` / `canPersonErasePersonalData`), re-read live from the database by
`anonymizeDiver` itself rather than trusted from its caller, and the staff surface additionally
requires the staffer to type the diver's name, verified server-side against the stored record.
Removal is a roster-hygiene chore a manager should own; erasure is a decision about the business's
own legal position. Two records are refused outright: **the actor's own** (`self`) and **anyone
holding a staff role** (`staff_member`) — a staff member's name on an activity event, roll call,
order, or attested waiver is the shop's accountability trail, not the diver's data, and staff
offboarding is a different problem.

### What is destroyed, per table

The rule: **rows that are only about the person and are not evidence of a past safety event are
deleted; rows that are evidence are kept and their personal fields scrubbed.**

| Table | Treatment |
| --- | --- |
| `people` | `full_name` → `[anonymized]` sentinel (NOT NULL); `email`, `phone`, `emergency_contact_*`, `date_of_birth`, `dive_insurance`, `locale`, `courtesy_email_opt_out_at` → null; `deleted_at` set; `anonymized_at`/`anonymized_by_person_id` stamped. Email must go to **null**, never a sentinel — `people_shop_email_unique` is a partial unique index on `lower(email)`, and a shared sentinel address is both a collision hazard and not an erasure. |
| `person_roles` | rows deleted — nothing downstream may treat an erased record as an active diver |
| `waiver_records` | `draft_signer_name`, `draft_medical_answers`, `signed_name`, `medical_answers`, `imported_from_label`, both `import_source_*_url`, `started_at` → null; `draft_acknowledged` → false; `token_hash` rotated to an unissued value and `expires_at` pulled to now (the URL *is* the capability); a still-pending record marked superseded; re-sealed under v2. Only an already-sealed record is re-sealed — erasure must not mint assurance a signing never had. |
| `certifications`, `specialty_certifications`, `nitrox_certifications` | `identifier` → a unique redacted value (NOT NULL, inside a partial unique index); `card_image_url` → null + blob queued; `review_note`, `imported_from_label` → null; `deleted_at` set. The *sighting* survives: agency, level/specialty, status, `reviewed_at`. |
| `rental_fit_profiles` | row deleted (body measurement) |
| `trip_waitlist_entries`, `last_minute_list_entries` (+ its unsubscribe tokens), `person_courtesy_email_unsubscribe_tokens` | rows deleted |
| `internal_notes` | rows deleted — `body` is NOT NULL with a non-blank check, so there is nothing to redact it *to*, and staff prose about a person is personal data end to end |
| `activity_events` | `message` → `[redacted]` (NOT NULL + non-blank check); the row, its actor, and its timestamp stay. Swept three ways — by booking, by actor, and by **matching the stored name**, because a note attached to the diver rather than a booking writes an event with a null `booking_id` and no person link at all. The name match can over-reach onto a same-named staff member's event; that is the right way round. |
| `roll_call_events` | `note` → null; the boarding fact stays |
| `bookings` | `group_preference` → null; the seat stays |
| `booking_payments` | `note` → null |
| `booking_capabilities` | revoked and expired |
| `calendar_feeds` | revoked (a live feed URL is a standing read credential) |
| `user_accounts` (if any) | `email` → a unique unusable address (NOT NULL + globally unique), `hashed_password` → a value nothing verifies against, `email_verified_at` → null, `status` → disabled; `account_tokens` deleted |
| `prior_visits` | `title`, `status_label`, `amount_label`, `source_label`, `source_reference` → null; `dedupe_key` → a unique redacted value; `visited_on` stays (the shop's own history) |
| `trip_reviews` | `comment` → null, **unpublished** (`is_published` false, `published_at` null) |
| `orders` | `hosted_invoice_url`, `invoice_pdf_url` → null — publicly reachable Stripe pages rendering the customer's name and email |
| `recap_photos` | rows deleted + blob queued (photographs of the diver) |
| `notification_deliveries` | `provider_detail`, `send_error` → null (bounce text quotes the address) |
| `notification_send_queue` | rows deleted, matched on `payload->>'to'` (case-insensitive) and `payload->>'bookingId'`. The one un-normalized PII blob; a work queue, not evidence. |
| `course_inquiries` | `name`, `email`, `phone`, `timing`, `message` → null, matched on the diver's email or phone — see residuals |

Blob objects (card photographs, recap photos, imported waiver documents) are retired through the
existing `media_deletion_attempts` ledger
([20260723-media-validation-and-deletion](20260723-media-validation-and-deletion.md)) rather than a
new mechanism; two enum values, `certification_card` and `waiver_document`, are added. The queue
row commits with the scrub and the durable nightly retry performs the provider call, so no network
call sits inside the erasure transaction.

The whole scrub is one transaction. A half-erasure — identity gone from `people`, medical answers
still in `waiver_records` — is the worst outcome available.

### Residuals — what this cannot erase

- **`orders.stripe_customer_id` and `stripe_invoice_id`** are `NOT NULL` pointers into Stripe's own
  records. The shop must retain them for tax and chargeback, and DiveDay cannot rewrite Stripe's
  copy of the customer's name and email from here. Erasure at the processor is a **separate, manual
  step** (deleting the Stripe customer) and is out of scope for this mechanism. Any commitment made
  to a diver about erasure must say so.
- **`course_inquiries` carries no `person_id` at all.** A lead is written before any person exists,
  so a `person_id`-driven sweep structurally cannot reach it; the sweep matches on the email or
  phone the diver themselves supplied, which is the only link there is. **An inquiry that carries
  neither a matching email nor a matching phone is not reached.** That is a stated gap, not an
  oversight: the alternative is fuzzy name matching, which would scrub other people's leads.
- **Backups and log aggregation** are outside the database and outside this ADR
  ([20260802-backup-and-restore-posture](20260802-backup-and-restore-posture.md) owns retention
  there). A restore from a pre-erasure backup reinstates the erased data.
- **Offline manifests** already cached on a crew device (`src/lib/offline-manifest-store.ts`) are
  encrypted client-side copies with their own lifetime; erasure does not reach them.

## Relationship to the archive and retention ADRs

- **[20260719-crud-archive-semantics](20260719-crud-archive-semantics.md)** says removal is soft and
  explicitly rejects hard-delete. This record **supersedes its diver bullet in part**: removal
  remains soft and reversible and stays the default, and every other entity's archive semantics are
  untouched. What changes is that soft removal is no longer the *only* thing a shop can do to a
  person record. The archive ADR's reasoning — that hard-delete "breaks historical context and can
  cascade through bookings, manifests, and assignments" — is honoured rather than overruled:
  erasure never deletes a booking, manifest entry, roll call, or waiver row. It blanks fields
  inside them.
- **[20260718-waiver-signature-retention](20260718-waiver-signature-retention.md)** and
  **[20260721-waiver-sign-once](20260721-waiver-sign-once.md)** require the retention model not be
  weakened. Erasure is the one operation that reaches into a completed record, so the guarantees
  are restated precisely: the template snapshot, version, and the fact and timing of signature are
  still immutable and still sealed; what is destroyed is the *signer's identity and medical
  content*, only ever by a deliberate owner action, only ever recorded inside the new seal. The
  retention ADR's own closing sentence already anticipated this — "retention duration, deletion
  requests, and jurisdiction-specific language remain shop-policy work before production
  deployment."

## Alternatives considered

- **Hard-delete the person and cascade** — destroys bookings, manifests, roll call, and signed
  releases; exactly what the archive ADR rejected, and it would leave the shop unable to show a
  release was ever signed.
- **Keep the medical answers, erase everything else** — not erasure. The medical questionnaire is
  the most sensitive thing on the record.
- **Drop `signedName`/`medicalAnswers` from the v1 HMAC field set instead of adding v2** — silently
  weakens every existing seal, including records nobody asked to erase, and makes a substituted
  signer name undetectable forever.
- **Leave erased records reading `invalid`** — trains staff to ignore the one indicator that
  distinguishes tampering from routine erasure, which is worse than no indicator.
- **Encrypt personal fields and throw away the key ("crypto-shredding")** — a real option, and
  strictly better for backups, but it needs a key-management story, a migration of every existing
  row, and reader changes across the whole app. Revisit if the backup residual above becomes the
  binding constraint.
- **Owner-or-manager gate, matching `canDeleteDiver`** — rejected; see Authorization.

## Consequences

Makes easy: honouring a diver's deletion request without destroying the shop's legal position; a
Signatures tab that distinguishes *erased* from *tampered*; blob cleanup that reuses the existing
durable ledger; an export bundle that carries `anonymized_at` so a destination system can tell an
erased record from an incomplete one.

Makes hard: nothing about the erased diver can be recovered or re-verified, including by the diver.
A shop's public review average moves when an erased diver's review is unpublished. Any future
column holding personal data must be added to `scrub()` **and** its per-table assertion in
`src/db/divers.test.ts`; a new column that is missed is a silent leak, which is why the test asserts
table by table rather than through a read helper that might filter it out of view.

Commits us to: `waiver_records.integrity_version` as a real, dispatched-on version number, and to
adding a version 3 (rather than editing v1 or v2) if the sealed field set ever changes again.

**Escape hatch.** If counsel (HD-10/HD-11) concludes a signed release may not be altered at all,
the mechanism is disabled by removing the owner-only gate's UI and refusing in `anonymizeDiver` —
the schema columns and integrity v2 stay harmlessly unused, and no already-erased record is
affected. If counsel instead requires erasure to reach backups, the crypto-shredding alternative
above becomes the migration, costing a re-encrypt of every personal column and reader changes
across the app.
