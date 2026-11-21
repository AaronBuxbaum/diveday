# certifications

Whether a diver's cards are real and current: agency checks, scanned cards, and taking back a
verification.

## Owns

- Agency checks: `agency-check.ts`, `agency-processing.ts`, `agency-verification.ts`.
- Cards: `cert-scan.ts` (reading a card photo), `card-undo.ts`, `card-restore.ts`,
  `certification-junior.ts`.

## Does not own

The cert gate itself (`src/lib/readiness.ts`, `src/lib/requirement.ts`), course certification
(`src/features/training/course-certified.ts`) and the cards table (`src/db/schema/`).

## Invariants

- Requirements and evidence are separate, and missing configuration fails closed; only verified,
  unexpired evidence at or above the required level clears a diver; every readiness blocker is
  typed.
- A card's Undo returns a verified card to every readiness read, inside its window only.
- Safety-critical: changes here get failure-path tests and a `dive-domain-expert` review.
