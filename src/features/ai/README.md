# ai

The model calls: the shared Claude transport, the assists staff see, and the prompts that draft
text for a person to review.

## Owns

- The transport: `claude/` (the call, its dark switch, web fetch) and `claude-call-content.ts`.
- The assists: `assists/` (execution and usage), `assist-results.ts`, and one file per surface
  (`booking-ask-assists.ts`, `content-assists.ts`, `desk-assists.ts`, `file-assists.ts`,
  `inbox-assists.ts`, `review-assists.ts`).
- Drafting prompts: `description-draft.ts`, `website-reading.ts`; the palette's spoken answer,
  `palette-answer/`.

## Does not own

Prompts that belong to another area's subject stay there (`src/features/gear/bench-note.ts`,
`src/features/waivers/waiver-draft.ts`, `src/features/sites/site-brief.ts`, …). The usage table is in `src/db/schema/`.

## Invariants

- A prompt module never reads medical data or the medical alert: `pnpm check:assist-prompts`.
- Dark is a normal state, never an error (ADR 20261018-claude-assists): with no key, external
  HTTP disabled, the shop's switch off or a spend cap reached, an assist answers "no assist" and
  the feature behind it works exactly as it does without Claude (`claude/dark.ts`).
