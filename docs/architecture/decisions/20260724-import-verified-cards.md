# 20260724-import-verified-cards — Trust a prior system's cards on import, and accept PDF import documents

- **Status:** Accepted
- **Date:** 2026-07-24
- **Supersedes (in part):** [20260723-contact-importer](20260723-contact-importer.md)'s "Imported
  cards land `claimed` (`pending`), never `verified`" rule, its "Enriched air is a claim, not a fill
  authorization" import rule, and its "Trust the source's verification status — rejected" alternative.
  Also lifts the "PDF document support deferred" gap from
  [20260724-import-waiver-acceptance](20260724-import-waiver-acceptance.md).

## Context

The contact importer (20260723) deliberately landed every migrated certification as a `claimed`
(`pending`) card: a source "verified" column was noted and ignored, and staff re-verified each card
at first contact exactly like a hand-entered one. The reasoning was sound in the abstract — a card
is evidence, not clearance, and a fast import mustn't board a diver on evidence no one here checked.

The product owner requested the opposite posture, and gave the reason: a record already sitting in a
shop's existing system was, in practice, checked by that shop when it was entered. Treating it as an
unverified claim on import throws away real work and forces the awkward "partial / never" framing on
the switching pages ("nothing arrives already verified", "no one boards on evidence no one here has
checked"). DiveDay should instead **operate under the assumption that what a shop already has in its
system was manually verified there** — trust it, flag it, and offer a light staff confirm — for
**all** import sources, including a shop's own spreadsheet. This mirrors the direction already taken
for imported waiver acceptance (20260724-import-waiver-acceptance): trust the prior shop, mark it
`imported`, keep it distinguishable forever.

This is a deliberate reversal of a documented safety default, made knowingly. The assistant building
it raised the sharp edge — an imported level card now clears depth gates, and an imported nitrox card
now authorizes enriched-air requests, on the strength of a CSV cell — and the product owner chose
"verified, but surfaced for a quick confirm" over both "keep it gated until re-checked" and "verified
with no confirm at all," for all sources. Recorded as a decision in
`docs/product/human-decisions.md` (H-20).

## Decision

- **Imported cards land `verified`, flagged imported.** `commitContactImport` (`src/db/import.ts`)
  inserts a level card and a nitrox card with `status: "verified"`, a non-null `importedAt`, and an
  optional `importedFromLabel` (the row's `waiver_source_name`/`prior_shop` value). Two new nullable
  columns carry this on `certifications` and `nitrox_certifications`; `specialty_certifications` is
  unchanged because a contact file has no specialty column to import from.
- **`verified` clears the boarding/depth gate; the confirm is a soft nudge there.** The readiness
  engine reads `status`, so an imported level card clears cert and depth gates on import — boarding is
  a supervised moment, specialties stay gated (not imported), and card **expiry still applies**.
  Still-fabricate-nothing holds: no card without a real number, no reconstructed medical answers.
- **The enriched-air fill is the one gate the confirm actually holds** (`dive-domain-expert` review,
  H-20). A nitrox card carries no expiry, and a wrong fill is the highest-consequence failure in the
  product, so the fill-authorization reads (`authorizesNitroxFill` in `src/db/nitrox.ts`, shared by
  `verifiedNitroxPersonIds`, `setBookingNitrox`, and the Today ungated-nitrox read) exclude an
  imported-but-unconfirmed card: an imported nitrox card gives **plain air** until a staffer taps the
  one-tap confirm (`reviewedAt`). Boarding still never waits — nitrox is not a boarding gate unless
  the trip is a nitrox charter. A hand-entered card (no `importedAt`) is unaffected.
- **"Surfaced for a quick confirm" is derived state, not a new column.** A normal staff verify stamps
  `reviewedAt`; an imported card leaves `reviewedAt` null, so `importedAt IS NOT NULL AND reviewedAt
  IS NULL` is exactly the "verified, awaiting a staff confirm" set. The diver's card UI
  (`CertificationCards.tsx`, `SpecialtyCards.tsx`) shows a permanent "imported" chip and a one-tap
  **Confirm card** button that reuses the existing `reviewCertification` / `reviewNitroxCertification`
  path (idempotent for an already-`verified` card — it just stamps `reviewedAt`). The roster surfaces
  a soft "N to confirm" badge (`summarizeDivers`). Confirming never changes gating; it only clears the
  nudge. The imported provenance stays forever.
- **PDF import documents.** `storeImportWaiverDocument` (`src/lib/storage/index.ts`) now accepts a PDF
  as well as an image. Routing is by the actual bytes (`%PDF-` magic), never the caller's
  content-type claim: a PDF skips the `sharp` decode/re-encode pipeline (which can't decode a PDF and
  would only ever emit JPEG) and is stored as-is with an `application/pdf` content-type and `.pdf`
  name, under the same `MAX_IMAGE_BYTES` (5 MB) cap and the same SSRF-safe `ingestImageUrl` fetch. The
  shared image allowlist (`ALLOWED_IMAGE_CONTENT_TYPES`, `DECODABLE_FORMATS`) is **not** loosened, so
  card, course, recap, and dive-site photos stay image-only.
- **The published honesty table (`IMPORT_HONESTY_TABLE`) is rewritten** to two calm buckets —
  `included` ("Comes across") and `stays-behind` ("Stays behind") — dropping the alarm-red
  "partial"/"never" chips. Cert, nitrox, role, and waiver rows are `included` and describe the
  verified-and-flagged posture; specialty cards, payment methods, and booking/service history are
  `stays-behind` with an honest reason each. The three surfaces that render the table (both switching
  pages and the in-app import wizard) update their chip maps to match.

## Alternatives considered

- **Keep imported cards gated until re-checked (`pending`)** — the original 20260723 posture;
  rejected by the product owner in favor of trusting what the shop's system already held. Left only
  the copy softened would have made the honesty table lie, since it renders the real importer scope.
- **Verified with no confirm at all** — rejected as too sharp: the one-tap confirm and the permanent
  `imported` marker are the cheap mitigation that keeps a migrated card distinguishable from one this
  shop carded on sight, without gating boarding on it.
- **Apply the trust only to real incumbent systems, not spreadsheets** — considered (a loose
  spreadsheet cell is weaker evidence than another system's verified record); rejected by the product
  owner in favor of one uniform rule and one shared honesty table for all sources.
- **A dedicated "confirm imported cards" queue page** — not built; the inline card confirm plus the
  roster "to confirm" count surface the same work without a new staff surface. Revisit if shops ask
  for a bulk-confirm view.
- **Loosen the shared image allowlist to admit PDFs everywhere** — rejected: only import documents
  need PDFs, and they are archival (never rendered from raw bytes). A card/course/recap photo is
  decoded and shown inline, so those stay image-only; the PDF path is import-document-scoped.

## Consequences

Easy: the switching pages can finally say plainly that a shop's cards come across ready to use, which
is the honest thing to say once the importer actually behaves that way; a migrating shop's divers are
trip-ready from the first booking instead of stacking up a re-verify backlog. The `imported` chip and
the "to confirm" nudge keep the provenance visible.

Hard, and worth a future owner's attention: this import path clears a diver to **board** on a card
DiveDay itself never inspected, held back there only by a non-gating confirm. The `dive-domain-expert`
review weighed this and drew the line at the enriched-air fill — the one irreversible, no-expiry,
highest-consequence action — which now waits for the confirm (`authorizesNitroxFill`) rather than
clearing on `status` alone. The boarding/depth posture is the remaining accepted risk: a supervised
moment, with specialties still gated and expiry still enforced. The escape hatch: to revert the whole
change, insert imported cards `pending` again and drop the `importedAt`/`importedFromLabel` writes —
the confirm branch, the `authorizesNitroxFill` predicate, and the honesty-table copy are the only
other places to touch. To go the *other* way (fills clear on import too), delete the
`importedAt/reviewedAt` clause from `authorizesNitroxFill`; nothing else changes.
