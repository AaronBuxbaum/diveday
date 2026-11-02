# 20260729-staffing-waiver-audit-and-localized-copy — Staffing coverage, waiver integrity, and locale-ready copy

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

Trip assignments show who is on a specific manifest, but they do not show who is available across
the day. Signed waiver rows preserve application history, but a separate integrity check makes a
signed snapshot auditable if ordinary row history is incomplete. Manifest-affecting edits need one
repeatable failure-mode review, and public/capability copy should not make English an implicit data
model.

## Decision

Add four small seams around the existing operational spine:

- `staff_shifts` stores dated availability windows. Trip assignments remain the authoritative
  manifest crew list; a staffing view compares the two and reports coverage gaps.
- Completed waiver records receive an HMAC over their signed metadata and template snapshot.
  Records created before this field exists remain explicitly `unsealed`; a mismatch is an audit
  stop, not a best-effort warning.
- `reviewManifestChange` is a pure preflight checklist for roster loss, capacity shrinkage,
  orphaned roll-call history, missing course instructors, empty crew, and changed boarding gates.
  Existing transactional guards still enforce the blocking cases.
- Shops have a `default_locale`, and public/capability copy can use `LocalizedCopy` values while
  legacy strings continue to render. Locale selection is a fallback, not a claim that DiveDay has
  translated every English string yet.

## Why

Staff availability is not the same fact as trip assignment, and a manifest must not silently infer
one from the other. Waiver row history explains application writes but does not independently show
that signed metadata still matches the evidence captured at completion. Keeping both checks pure and
shop-scoped makes them testable and leaves room for a translation editor without changing the
meaning of course or waiver records.

## Alternatives considered

- **Infer working availability from trip assignments** — rejected; assignment is the boat's actual
  crew, not a shift or an availability promise.
- **Use a plain SHA-256 hash** — rejected; an HMAC gives a database-only editor less ability to
  forge a matching seal without the application secret.
- **Replace all existing text fields with locale-keyed JSON immediately** — rejected; it would make
  a translation migration a prerequisite for shipping operational safety work. Strings remain valid
  while new copy can use locale maps.

## Consequences

- The staffing page is useful with no shifts, but intentionally shows the missing coverage rather
  than fabricating availability.
- HMAC verification depends on `WAIVER_INTEGRITY_SECRET`, then `AUTH_SECRET`, with a development
  fallback for local fixtures. Production should set the dedicated secret before relying on the
  audit result.
- Existing seed and imported waiver records can be unsealed until they are re-created or a later
  backfill seals them from trusted source evidence.
- Translation management and per-copy locale editing remain follow-up work.

## Amendment 2026-10-23 — shop questions join the seal, conditionally

A release version can now carry the shop's own **shop questions** (glossary *Shop question*), and a
signed record keeps the diver's answers as a snapshot, `waiver_records.shop_answers`: each
question's id, kind, prompt, whether it was required, a choice's options and the answer. The
snapshot is what was asked and answered, so it is signed evidence and the seal covers it.

- **The key is conditional.** `shopAnswers` joins the version 1 field set in `signedMetadata`
  (`src/lib/waiver-integrity.ts`) only when the column is not null. A release signed before shops
  could ask anything, and any release whose version asked nothing, has a null snapshot and hashes
  exactly the bytes it was sealed with, so every existing digest still verifies with no backfill
  and no new version number. A record whose version asked questions always has a non-null snapshot
  (an unanswered optional question is an entry with a null answer, never a missing one), so
  stripping the snapshot from such a record changes the digest and reads `invalid`.
- **Versions 3 and 4 inherit it** by spreading the version 1 set, as they inherit every other
  field. **Version 2 (erased) excludes it**: erasure strips the answers with the rest of the
  diver's own words and re-seals without them. Because the answers cannot survive erasure, a version
  2 record that carries `shop_answers` or `draft_shop_answers` again reads `invalid`, the way
  version 4 refuses a guardian address put back.
- `shopAnswers` is in `WAIVER_SEALED_FIELDS`, so the integrity readers (`WAIVER_SEALED_COLUMNS`)
  select it. The unsigned draft, `draft_shop_answers`, is never sealed, never exported and is
  cleared on signing.
- The snapshot is built on the server from the record's own `template_id`, never from what the
  form posted, so a prompt or option the browser altered never reaches the seal.

Rejected: a new seal version for the answers. It would have split the verifier on a fact the
column's own null already says, and left every pre-existing record on a version it does not need.

## Amendment 2026-10-23 — the medical alert for the crew is a second conditional key

A signed record can now carry the diver's **medical alert for the crew** (glossary entry of that
name, issue #2960, H-20261023-medical-alert-for-the), `waiver_records.medical_alert`: plain text the diver wrote, at most 500
characters. It is what the diver signed beside, so the seal covers it, by the rule above.

- **The key is conditional.** `medicalAlert` joins the version 1 field set only when the column is
  not null, so every existing digest, with or without shop answers, still verifies byte for byte.
  A blank alert is stored as null, never as an empty string, so "the diver wrote nothing" has one
  spelling and one digest. Stripping an alert from a record that had one changes the digest and
  reads `invalid`.
- **Versions 3 and 4 inherit it; version 2 (erased) excludes it.** Erasure nulls the alert and its
  draft with the diver's other words, so a version 2 record carrying `medical_alert` or
  `draft_medical_alert` reads `invalid`.
- `medicalAlert` is in `WAIVER_SEALED_FIELDS`; the draft, `draft_medical_alert`, is never sealed,
  never exported, joins the shared draft-column list and is cleared on signing.
- The alert never feeds readiness, admission, referral or any count. The seal makes it evidence of
  what the diver wrote, not of anything about their fitness.
