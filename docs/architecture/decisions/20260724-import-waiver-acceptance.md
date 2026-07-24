# 20260724-import-waiver-acceptance — Trust a prior shop's waiver acceptance on contact import

- **Status:** Accepted
- **Date:** 2026-07-24
- **Supersedes (in part):** [20260723-contact-importer](20260723-contact-importer.md)'s "Medical/health
  answers never import (fail-closed)" rule and its "Import medical answers as satisfied — rejected"
  alternative. Every other rule in that ADR (claimed-not-verified cards, no fabricated identifiers,
  nitrox as a claim, email matching) is unchanged.

## Context

The contact importer (20260723) deliberately never imported a waiver or medical clearance: "a
'cleared' flag from another system is not clearance here." That was a considered fail-closed default,
consistent with DiveDay's waiver domain rule that a signed release is safety and legal evidence
(20260718-waiver-signature-retention) and with the still-open legal-policy gates H-01–H-03 in
`docs/product/human-decisions.md` (jurisdiction, template wording, e-signature assurance level — none
of which are decided even for DiveDay's own in-house waiver yet).

The product owner explicitly requested the opposite: if a shop's prior system already had a diver
accept a waiver, DiveDay should accept that as satisfying its own waiver requirement rather than
re-collecting it — including trusting the prior system's medical clearance, and **without** requiring
a staff attestation per row (unlike the existing in-person/paper-signature path, which does require
one). This is a deliberate reversal of a documented safety default, made knowingly: the assistant
building this raised the conflict with the fail-closed rule and the open legal gates before
implementing, and the product owner confirmed the direction anyway. It is recorded as a decision in
`docs/product/human-decisions.md` (H-17) alongside the still-open H-01–H-03 items, since it does not
resolve them — it only decides what an *import* does, not what DiveDay's own waiver policy should be.

## Decision

- A contact-import row may claim a prior waiver acceptance via new columns: `waiver_accepted`
  (truthy), `waiver_signed_at` (a calendar date, best-effort — an unparseable value is dropped with a
  warning rather than misdating legal evidence), `waiver_source_name` (free text, e.g. the prior
  shop/system), and optional `waiver_document_url` / `medical_document_url` (a link to a scanned
  copy).
- On commit, a truthy claim writes an ordinary immutable `waiver_records` row: `status: "completed"`,
  `signatureMethod: "imported"`, `medicalReviewRequired: false`, `medicalAnswers: null` (no
  structured medical answers are ever fabricated — only the accept/no-review-needed *outcome*
  carries over), `recordedByPersonId` set to the staff member who ran the import (accountability for
  the import action, reusing the same column the paper-signature path uses for its attester — but
  **no attestation is required or captured**, per the product owner's explicit instruction), and
  `signedAt`/`consentedAt` set to the row's real acceptance date when given, or the import time
  otherwise. `templateId`/`templateVersion`/`templateBody` snapshot the shop's *current* template for
  reference only — the diver did not agree to that exact text, which is why the record is always
  marked `imported` everywhere staff or a diver-facing surface might read it.
- `waiver_records.bookingId` becomes nullable (schema change) — an import creates people, not
  bookings, so an imported record has no booking to attach to. `personId` is what makes it satisfy
  readiness on any of the diver's bookings, exactly like the existing sign-once carry-forward already
  works for any other completed record. A `requireTokenBookingId` helper documents and enforces the
  invariant that every *token-reached* record (issued links, paper attestation) still always has one.
- `isCompletedWaiverCurrent` (`src/lib/waivers.ts`) exempts `signatureMethod === "imported"` from the
  template-version match (it was never signed against any version of this shop's own template) but
  **not** from the one-year signature-age check — an imported record's true original acceptance date
  still ages it out exactly like any other, so a waiver accepted five years ago at the prior shop does
  not read as current here.
- Never duplicates or disturbs existing evidence: a row is skipped (counted, not silently dropped) if
  the diver already has a current `completed`/`medical_review` record, or if the shop has no waiver
  template configured to snapshot against.
- `waiver_document_url` / `medical_document_url` are fetched once, server-side, and re-stored through
  DiveDay's own image pipeline (`storeImportWaiverDocument`, reusing the existing SSRF-safe
  `ingestImageUrl`) before being written — never rendered from the raw staff-pasted URL directly. Only
  image formats are supported this slice (the same JPEG/PNG/WebP/HEIC, 5 MB allowlist every other
  image upload uses); a PDF link will not attach. This is a stated gap, not a silent one — the import
  wizard's honesty table says so.
- The published import honesty table (`IMPORT_HONESTY_TABLE`) is rewritten to describe this
  truthfully: "partial" scope for "Signed waivers & medical clearance," stating plainly that DiveDay
  trusts the source including medical clearance, marks the record `imported`, and never reconstructs
  individual medical answers.

## Alternatives considered

- **Require a staff attestation per row (like the paper-signature path)** — the assistant's initial
  recommendation; explicitly rejected by the product owner ("don't require staff to attest to old
  approved waivers"). Recorded here so a future reader knows it was considered and turned down, not
  overlooked.
- **Archive-only (never satisfy the waiver gate)** — safer, and closer to the original fail-closed
  default; rejected by the product owner in favor of actually clearing the gate.
- **Keep medical fail-closed while trusting only the general liability release** — the assistant's
  fallback recommendation; explicitly rejected by the product owner in favor of trusting the source's
  medical clearance too.
- **Reconstruct structured medical answers from source columns** — not attempted: there is no
  reliable mapping from an arbitrary rival system's medical form onto DiveDay's own questionnaire
  shape (`src/lib/medical.ts`), and a fabricated mapping would be worse than none.
- **PDF document support in this slice** — deferred: the existing image-storage pipeline
  decodes/re-encodes images specifically; PDF needs its own validation path, out of scope here and
  stated as a gap rather than silently dropped.

## Security review notes (2026-07-24)

- Document fetches run at a bounded concurrency (`DOCUMENT_FETCH_CONCURRENCY = 6` in
  `src/db/import.ts`), not one `Promise.all` per document across the whole batch — an unbounded
  fan-out over up to 5,000 rows × 2 URLs each would open thousands of simultaneous outbound
  connections from a single staff submission.
- `ingestImageUrl` short-circuits an already-`isManagedBlobUrl` document URL to "unchanged" (no
  re-fetch, no ownership check) — the same behavior every other pasted-URL field in this codebase
  already has (`src/lib/storage/ingest-url.ts`). A staff member could in principle paste another
  shop's already-public blob URL as a document link; nothing confidential is newly exposed (the
  object is already public-by-URL), but the resulting `importSourceDocumentUrl` would not actually
  belong to the importing shop's own evidence. Accepted as consistent with existing precedent, not
  hardened further in this change.

## Consequences

Easy: a migrating shop's roster arrives with its waiver history intact, closing one more "switching is
safe" gap in the data-portability wedge; the CSV schema mirrors the export's own `waiver_records.csv`
provenance fields, so a round trip stays legible. Hard, and worth a future owner's attention: this
import path can now clear a diver to board on evidence DiveDay itself never reviewed and a
questionnaire it never asked — the `imported` marker and `docs/product/human-decisions.md` H-17 exist
specifically so this is never mistaken for DiveDay's own reviewed waiver flow. Before any shop relies
on this in production, the same legal/policy sign-off the base waiver flow still needs (H-01–H-03)
applies with extra force here, since the shop is now also vouching for another operator's process. The
escape hatch: if that review concludes imported acceptance is unsafe, `signatureMethod: "imported"`
and `IMPORT_HONESTY_TABLE`'s waiver rows are the only places to revert — the write path and currency
exemption can be disabled without touching any other import behavior.
