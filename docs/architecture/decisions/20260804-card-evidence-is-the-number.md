# 20260804-card-evidence-is-the-number — A certification card's evidence is its number, not its photo

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Both staff card-capture forms — certification cards and specialty/nitrox cards — carried an
optional photo upload alongside the agency, level, and card number. It was the last surviving
half of a chain: 20260718-card-image-storage added the upload seam, 20260719-card-photo-only
removed the pasted-URL alternative so the photo was the only image path.

A photo never actually established anything. What makes a card trustworthy in this product is a
staffer looking the number up with the issuing agency and pressing **Mark certified** — the same
act, and the only act, that lets the card count toward readiness (`reviewCertification`). A
snapshot of the plastic is a second artefact nobody verifies against, and one that costs real
things to hold: personal data in blob storage that erasure has to reach into
(`src/db/anonymize.ts`), rows in every export bundle, an upload path to validate (CR-011/CR-012),
and one more field between a front-desk staffer and a captured card.

## Decision

- **Neither card form offers a photo.** The `cardImage` file input, the `resolveCardImage` step in
  `addCertificationAction`/`addSpecialtyAction`, and the `image` / `captured-no-photo` notices are
  gone. A card is captured from agency, level/specialty, number, and an optional refresher date.
- **`storeCardImage` goes with them.** The shared upload pipeline in `src/lib/storage/` is
  unchanged and still carries course, recap, dive-site, and import-document uploads; only the
  card-specific wrapper and `MAX_CARD_IMAGE_BYTES` are removed, and `src/lib/storage/index.test.ts`
  now exercises the same pipeline through `storeCourseImage`.
- **`card_image_url` stays, and so does every display of it.** The column, the digital-card flip's
  photo face, the specialty row's "View card photo" link, the erasure retirement path, and the CSV
  export column all remain. Shops that captured photos before this keep seeing them; nothing that
  was stored is orphaned or silently hidden.

## Alternatives considered

- **Drop `card_image_url` and delete the stored photos.** Rejected: it destroys data shops
  captured under the old behaviour, and erasure — not a UI change — is the right instrument for
  removing a diver's images.
- **Keep the upload but make it staff-optional messaging ("evidence, not proof").** Rejected as
  the status quo with better copy. The field's cost is that it exists at the desk at all; a
  clearer caption does not remove the upload path, the blob rows, or the validation surface.
- **Keep the upload for imported cards only.** Rejected: contact import has never carried a card
  image (`src/lib/import.ts` has no such column), so there is no import case to serve.

## Consequences

- Capturing a card is four fields and one button. The trust story is single: certified means a
  staffer checked the number with the agency.
- The card-photo attack surface disappears with the input. CR-011 (oversize rejection) and CR-012
  (decode/re-encode, disguised-file rejection) remain enforced at the shared seam and covered by
  `src/lib/storage/index.test.ts`; the three e2e tests that drove them through the card form were
  removed with the form, with a note at their old site saying so.
- Cert-card OCR (`docs/product/features/ai-ml.md`) loses its assumed input. If it is ever built it
  needs its own capture path — most likely a scan-then-discard flow that reads the number and
  keeps no image — rather than reinstating a stored photo.
- Reversible at the cost of one form field: the column, the display, and the storage pipeline all
  survive, so restoring the upload is additive rather than a migration.
