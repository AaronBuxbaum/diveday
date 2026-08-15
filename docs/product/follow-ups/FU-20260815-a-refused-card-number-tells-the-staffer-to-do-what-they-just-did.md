# FU-20260815-a-refused-card-number-tells-the-staffer-to-do-what-they-just-did — Give the card-number shape check its own refusal, and close the two gaps beside it

- **Status:** Open
- **Raised:** 2026-08-15 — the `security-reviewer` and `dive-domain-expert` passes on the card
  sighting shape check (ADR 20260814-self-declared-cards, 2026-08-15 amendment). Both raised the
  same seam independently.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/_components/CardSightingForm.tsx`,
  `src/i18n/locales/en-US/staff/divers.json`, `src/i18n/locales/es-ES/staff/divers.json`,
  `src/db/schema.ts`

## What I noticed

The card number on the diver record is now shape-checked (`isPlausibleCardNumber` — three characters
and at least one digit) because *"xx"* used to certify a self-declared "Instructor". The check is
right; **what happens when it refuses is not.**

A failed parse makes `sightingFromForm` / `levelSightingFromForm` return `undefined`, which is
exactly what a submit carrying *no* sighting returns. So the staffer gets
`divers.notices.cardSightingRequired`: *"This card is only what the diver told us. Enter the agency
and number from the card in front of you to certify it."* They did. The `<details>` re-collapses and
their typed agency, level and number are gone.

At a busy dock that person retypes it once, gets the same sentence, and then goes around the form:
delete the claim, capture the card by hand, tap Mark certified. That reaches the identical `verified`
state while throwing away `self_declared_at` — the stamp the incident export, the "diver's word"
mark and every provenance read depend on. A refusal that does not say what is wrong is how a
safety-critical form teaches people to route around it.

Two smaller things sit on the same seam, both pre-existing, both cheap to fix while you are here:

- **`certifications_identifier_present_unless_self_declared` is weaker than three comments claim.**
  It is `identifier is not null or (...)`, and `''` satisfies `NOT NULL` — so "a self-declared row
  cannot reach `verified` without a number" is enforced by the database only against NULL, and by
  the application for the empty string. No writer can produce `''` today; the comments in
  `src/db/readiness.ts`, `CardSightingForm.tsx` and the ADR overstate it (the ADR now says so).
- **`certificationId` reaches a `uuid` column unvalidated** in `reviewAction`,
  `reviewSpecialtyAction`, `deleteCertificationAction`, `deleteSpecialtyAction` and
  `restoreCardAction`. Postgres raises on a malformed literal rather than matching zero rows, so a
  signed-in staffer can turn any of those into a 500 from the address bar. Tenant isolation is
  unaffected — the `shopId` predicate is there either way — but the repo's own `uuidParam()`
  convention exists for exactly this and covers only route segments.

## Why it isn't already done

The refusal copy lives in the `?notice=` string set of a file another session was actively
restructuring, so the session that added the shape check could not add a code to it without
colliding. The constraint fix needs a `src/db/schema.ts` migration that same session was scoped out
of. The uuid guard is a pre-existing gap in five actions and belongs with whoever is already in that
file rather than as a drive-by.

## Proposed change

1. **A distinct refusal.** Add a `card_number_implausible` reason alongside `card_sighting_required`,
   and surface it as a **field-level** error on the number input via `Field`'s `error` prop rather
   than as a page notice — a refusal belongs where the work is
   (docs/design/forms-and-controls.md). Copy, both locales, roughly: *"That doesn't look like a card
   number. Type the number printed on the card, digits included."* Keep the `<details>` open and the
   typed values in place on the way back.
2. **Make the database hold the line it is credited with**: an additive migration changing the check
   to `length(btrim(identifier)) >= 3 or (self_declared_at is not null and status = 'pending')` on
   `certifications` and its `nitrox_certifications` twin, and fix the three comments that overstate
   the current one. Read the **schema-change** skill first; both tables satisfy the new predicate on
   arrival, so it is additive under scripts/check-migrations.mjs.
3. **Narrow the ids**: parse `certificationId` with a uuid schema in the five actions, refusing to
   the existing `invalid` notice rather than raising.

**Not** proposed: loosening or removing the shape check, or making the capture form looser than the
sighting again — the two doors reach the same `verified` state and were deliberately levelled.

## Prompt

```text
The card-number shape check on the diver record refuses without saying why, and the refusal is
indistinguishable from "you submitted no sighting at all". Fix that, and close the two gaps beside
it.

Read first, in this order:
  - docs/product/follow-ups/FU-20260815-a-refused-card-number-tells-the-staffer-to-do-what-they-just-did.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md — the 2026-08-15 amendment's
    paragraph on the shape check, which records the honest scope of the database constraint
  - src/lib/card-number.ts (the predicate and why it is deliberately loose)
  - src/app/shop/[shopSlug]/divers/[personId]/actions.ts — `cardNumberSchema`, `sightingSchema`,
    `sightingFromForm`, `levelSightingFromForm`, `reviewNotice`
  - src/app/shop/[shopSlug]/divers/[personId]/_components/CardSightingForm.tsx
  - src/db/readiness.ts (`reviewCertification`) and src/db/nitrox.ts
  - docs/design/forms-and-controls.md — a refusal goes on the field, never in a page banner

The work: a `card_number_implausible` refusal wired to the number input's own `Field` error in both
locales; an additive migration tightening
`certifications_identifier_present_unless_self_declared` (and its nitrox twin) so `''` cannot
satisfy it, plus the three comments that currently overstate what it enforces; and a uuid parse on
`certificationId` in the five actions that pass it straight into a query.

Constraints that make this non-obvious:
  - Do NOT loosen the shape check, and do not make the capture forms looser than the sighting —
    they reach the identical `verified` state, and the asymmetry was the bypass.
  - A claim must never become evidence without a card sighting. Nothing here may make it easier to
    certify a self-declared row.
  - Every string in both en-US and es-ES in the same change (pnpm check:locale); read
    src/i18n/locales/es-ES/README.md first — a diver is "el buceador", never "el buzo".
  - Read the schema-change skill before the migration; it must pass scripts/check-migrations.mjs
    and be safe while the previous release is still serving.

Done when: typing "xx" into a card sighting shows an error on that field saying what is wrong, with
the form still open and the other values still typed; a unit test covers the new refusal reason and
one covers a malformed posted sighting collapsing to `undefined` rather than a partial object; the
migration is in place; pnpm check is green; and
docs/product/follow-ups/FU-20260815-a-refused-card-number-tells-the-staffer-to-do-what-they-just-did.md
is deleted as part of the change.
```
