# 20260811-retire-the-digital-card — The card's evidence has no picture left to show

- **Status:** Accepted
- **Date:** 2026-08-11
- **Supersedes the storage and display halves of:**
  [20260804-card-evidence-is-the-number](20260804-card-evidence-is-the-number.md)

## Context

[20260804-card-evidence-is-the-number](20260804-card-evidence-is-the-number.md) removed the card
*upload* — a photograph of the plastic never established anything, because what makes a card
trustworthy here is a staffer looking its number up with the issuing agency and pressing **Mark
certified**. It deliberately kept every *display* of `card_image_url`, so shops that had captured
photos before the change kept seeing them.

The same logic applies to what that decision left standing. Nothing writes `card_image_url` any
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
- **`card_image_url` is dropped from both tables, and export and erasure lose it with them.**
  `20260812001834_retire-card-image-url` drops the column from `certifications` and
  `specialty_certifications`, each statement carrying the `diveday:allow-destructive` marker the
  migration guard requires (ADR 20260806-destructive-migration-guard). The two
  `retire("certification_card", …)` calls leave `src/db/anonymize.ts`, the column leaves both CSVs
  and the export bundle's photo manifest, and the `certification_card` media-deletion kind becomes
  unreachable.

## Alternatives considered

- **Keep the column for legacy rows, and purge the blobs in a separate, later change.** This was
  the first shape of this decision, and it is the right one for a product with shops on it:
  dropping a column whose stored objects still exist strands every object in the blob store with
  nothing left pointing at it, so the purge has to go through the media-deletion ledger *first* and
  drain before the column goes. Reversed on the one fact that changes the calculus — **there are no
  live shops and no row holds a value.** With nothing to strand, the two-phase dance protects
  nothing and leaves a dead column, two dead CSV headers and a dead erasure branch in the tree
  indefinitely. The staged plan is written down here in case the column is ever reintroduced and
  has to come out again against real data.
- **Keep the digital card for legacy rows only** (render it when `cardImageUrl` is set). Rejected:
  it makes the card a surface most shops never see and nobody can reason about, and it keeps the
  component, its copy in both locales, and its test alive to serve a shrinking set of rows.
- **Keep the front face, drop the photo back.** Rejected: the front face is the row restated. A
  card-shaped restatement of four adjacent facts is duplication (principles #9) with a flip
  animation on it.

## Consequences

- A certification row is what it claims to be: agency, level, number, refresher date, a status
  badge, and the review controls. There is no second, prettier rendering of the same record.
- There is no card photograph anywhere in the model: not in the UI, not in the schema, not in the
  export bundle, and nothing for erasure to reach into. The `certifications.csv` and
  `specialty_certifications.csv` headers each lose a column, which is a shape change for anyone
  with tooling around those files — acceptable now, and the reason this could not have been done
  once shops were live.
- The `certification_card` value on the `media_deletion_kind` enum is now unreachable. It is left
  in place: Postgres has no `ALTER TYPE … DROP VALUE`, so removing it means recreating the type
  that `media_deletions.kind` depends on — a materially riskier migration than the two column drops
  here, for a dead enum member that costs nothing. Its staff label
  (`settings.main.dataJobs.mediaKind.certification_card`) and Today's
  (`shared.today.opsAlert.mediaKind.certificationCard`) stay with it, so a row written before this
  release would still render a word rather than a raw enum value.
- Cert-card OCR (`docs/product/features/ai-ml.md`) is unaffected — it already noted there is no
  stored card photo to read.
- Reversal is now a migration, not just a component and a copy block. That is the trade being
  made, and it is only available because nobody is on the product yet.
