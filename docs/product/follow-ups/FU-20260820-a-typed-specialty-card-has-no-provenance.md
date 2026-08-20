# FU-20260820-a-typed-specialty-card-has-no-provenance — Give `specialty_certifications` a `self_declared_at`, then let a diver send one

- **Status:** Open
- **Raised:** 2026-08-20 — `security-reviewer` pass (F1) on the diver-facing certification entry forms
- **Kind:** half-done
- **Effort:** M
- **Touches:** `src/db/schema.ts`, `src/db/readiness.ts`, `src/db/self-declared-cards.ts`, `src/app/ready/[token]/page.tsx`, `src/app/ready/[token]/actions.ts`, `src/app/shop/[shopSlug]/divers/[personId]/_components/SpecialtyCards.tsx`

## What I noticed

The readiness page now offers an entry form for every card a trip is still
waiting on — **except a specialty card**, which was built, reviewed, and taken
back out before it shipped. The reason is a missing column.

`certifications` and `nitrox_certifications` both carry `self_declared_at`, and
both `reviewCertification` / `reviewNitroxCertification` refuse the ordinary
one-tap "Mark certified" on a row that has it: they demand the agency and number
off the card in the staffer's hand (`CardSighting`). That is exactly what makes a
diver-facing form safe on those two tables — what a diver types can be told apart
from what a colleague transcribed.

`specialty_certifications` has **no such column**, deliberately, because until now
nothing diver-writable could reach it (`src/db/self-declared-cards.ts` says so in
two places). So a row a diver typed would render on the staff card list
byte-for-byte like a staff transcription, get the one-tap promote, and land
`verified` — which is what clears a Deep gate past 18 m. A specialty is the thing
that authorizes a materially riskier dive; it is the worst table to launder a
number into.

Second, quieter problem on the same column: `holdsRealCardOutsideLevels`
(`self-declared-cards.ts:235`) counts **any** live specialty row as real evidence
of the diver, which suppresses a later level claim. A typed specialty row would
silently switch off a diver's own level declaration.

## Why it isn't already done

It is a schema change plus three guard changes, arriving inside a UX slice, and
it wants its own review — the same `dive-domain-expert` + `security-reviewer` pair
the original change got. Doing it in a rush at the end of a long branch is how the
hole got there in the first place.

One design question worth answering rather than defaulting: **should the column be
`self_declared_at`, matching its two siblings, or a distinct `diver_supplied_at`?**
They are not quite the same fact. `self_declared_at` on `certifications` means "a
stranger typed a rung with no number at all"; a specialty card typed on `/ready`
carries a real number behind a verified bearer capability. Matching the sibling
name keeps `isUnsightedSelfDeclaration` working unchanged and is what I would do,
but it slightly widens what that predicate means.

## Proposed change

1. Add `self_declared_at timestamptz` to `specialty_certifications`, mirroring the
   two sibling tables, with the same `identifier`-present check relaxation **only
   if** you also decide a numberless specialty claim is a thing (I would not — keep
   `identifier` NOT NULL and require the number).
2. Give `reviewSpecialtyCertification` the `sighting?: CardSighting` parameter and
   the `card_sighting_required` refusal its two siblings already have.
3. Exclude self-declared rows from the specialty arm of
   `holdsRealCardOutsideLevels`, using the `isRealCard` predicate the nitrox arm
   beside it already uses.
4. Restore the specialty entry form: `SpecialtyEntry` and `saveSpecialtyFromReady`
   were written and deleted in commit-of-this-branch; recover them from git
   history rather than rewriting. `SPECIALTY_ENTRY_CODES` was `specialty_missing`
   and `specialty_expired` — not `specialty_pending` or
   `specialty_import_unconfirmed`, which mean the shop already holds something.
5. Confirm `SpecialtyCards.tsx` labels the row "diver's word, no card", which it
   should get free from `isUnsightedSelfDeclaration`.

Do **not** ship step 4 without steps 1–3. The form is the easy part; the guards
are the reason it is allowed to exist.

## Prompt

```text
Read docs/architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md
and src/db/self-declared-cards.ts's module docstring first, then the
`reviewNitroxCertification` guard in src/db/nitrox.ts — that guard is the pattern
to copy.

`specialty_certifications` has no `self_declared_at` column, so a card a diver
typed cannot be told apart from a staff transcription. That is why the readiness
page offers level and nitrox entry forms but no specialty one: with the ordinary
one-tap "Mark certified", a diver-typed number would land `verified` and clear a
Deep gate past 18 m.

Add `self_declared_at` to specialty_certifications (`pnpm db:generate`; additive,
so the destructive-migration guard stays quiet). Give
`reviewSpecialtyCertification` the same `sighting?: CardSighting` parameter and
`card_sighting_required` refusal its nitrox and level siblings have. Then fix the
second bug on the same column: `holdsRealCardOutsideLevels` counts any live
specialty row as real evidence, so a typed one would suppress the diver's own
level claim — use the `isRealCard` predicate the nitrox arm above it already uses.

Only then restore the specialty entry form on /ready. `SpecialtyEntry` and
`saveSpecialtyFromReady` were written and removed on the ux-refinements-nine
branch — recover them from git history rather than rewriting. They land `pending`,
require the card number (identifier is NOT NULL and should stay so), and fix the
specialty from the blocker rather than offering a picker.

Done when: pnpm check is green, a test proves a diver-typed specialty card cannot
be promoted without a sighting, and a second proves it does not suppress a level
declaration. Get a `security-reviewer` pass before merge — this is the table that
authorizes the deepest dive in the product. Delete
docs/product/follow-ups/FU-20260820-a-typed-specialty-card-has-no-provenance.md as
part of the change.
```
