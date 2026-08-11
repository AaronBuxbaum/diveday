# 20260811-retire-the-digital-card — The card's evidence has no picture left to show

- **Status:** Accepted
- **Date:** 2026-08-11
- **Supersedes the display half of:**
  [20260804-card-evidence-is-the-number](20260804-card-evidence-is-the-number.md)

## Context

[20260804-card-evidence-is-the-number](20260804-card-evidence-is-the-number.md) removed the card
*upload* — a photograph of the plastic never established anything, because what makes a card
trustworthy here is a staffer looking its number up with the issuing agency and pressing **Mark
certified**. It deliberately kept every *display* of `card_image_url`, so shops that had captured
photos before the change kept seeing them.

A year of that decision's logic applies to what was left. Nothing writes `card_image_url` any
more, so the surfaces reading it can only ever be looking at data no shop can add to:

- **The digital card** (`DigitalCardFlip`) — a 320×200 gradient card with the agency, level, and
  diver's name on the front and, on the back, either the legacy photo or a placeholder reading
  "NO CARD PHOTO / Awaiting staff verification". For every shop onboarded since the upload was
  removed, the back face is *always* the placeholder: a flip animation whose payoff is a message
  saying there is nothing there. The front face restates, in a skeuomorphic frame, the four facts
  the row above it already states in plain text — including the verification status, which the row
  renders as a `Badge` with the app's own tone vocabulary.
- **The specialty row's "View card photo" link**, present only on legacy rows.

Neither surface answers a question a staffer has. The one thing they add over the row itself is
the impression that DiveDay holds a verified credential artefact, which is exactly the claim
20260804 decided this product does not make.

## Decision

- **`DigitalCardFlip` is deleted**, with its test and its whole `divers.certifications.card.*`
  copy block, and the "View digital card" disclosure on each certification row goes with it.
- **The specialty row's "View card photo" link is deleted**, with `divers.specialty.viewCardPhoto`.
- **`cardImageUrl` leaves the write path**: `createCertification` and `createSpecialtyCertification`
  no longer accept it. It was already unreachable from the app; removing the parameter makes that
  a compile-time fact.
- **`card_image_url` stays in the schema, and so do export and erasure.** Both columns are
  documented in `src/db/schema.ts` as legacy-only. Diver erasure still retires the stored object
  through the media-deletion ledger (`src/db/anonymize.ts`), and the CSV export still carries the
  column, so a shop's own data-out bundle is still complete.

## Alternatives considered

- **Drop the column and purge the blobs in the same change.** Rejected *for now*, not on the
  merits: it is a destructive migration under `pnpm check:migrations`, and the blob purge has to
  run through the media-deletion ledger with its retry semantics rather than as a one-shot script.
  Filed as a follow-up (`docs/product/follow-ups/`) so it is a considered piece of work rather than
  a rider on a UI pass.
- **Keep the digital card for legacy rows only** (render it when `cardImageUrl` is set). Rejected:
  it makes the card a surface most shops never see and nobody can reason about, and it keeps the
  component, its copy in both locales, and its test alive to serve a shrinking set of rows.
- **Keep the front face, drop the photo back.** Rejected: the front face is the row restated. A
  card-shaped restatement of four adjacent facts is duplication (principles #9) with a flip
  animation on it.

## Consequences

- A certification row is what it claims to be: agency, level, number, refresher date, a status
  badge, and the review controls. There is no second, prettier rendering of the same record.
- Legacy photos become invisible in the product while remaining fully accounted for in export and
  erasure. That is the honest position: they are data the shop owns and can take out, not evidence
  the product presents.
- Cert-card OCR (`docs/product/features/ai-ml.md`) is unaffected — it already noted there is no
  stored card photo to read.
- Reversal is a component and a copy block, not a migration.
