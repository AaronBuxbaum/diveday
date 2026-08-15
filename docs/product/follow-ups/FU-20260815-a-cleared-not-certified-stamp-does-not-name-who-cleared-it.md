# FU-20260815-a-cleared-not-certified-stamp-does-not-name-who-cleared-it — Put the staff member's name on the correction, on screen

- **Status:** Open
- **Raised:** 2026-08-15 — the `security-reviewer` and `dive-domain-expert` passes on the eraser for
  `people.no_certification_declared_at` (ADR 20260814-self-declared-cards, second 2026-08-15
  amendment). Both said the same thing: the correction is recorded but not readable.
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/db/divers.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/_components/CertificationCards.tsx`,
  `src/i18n/locales/en-US/staff/divers.json`, `src/i18n/locales/es-ES/staff/divers.json`

## What I noticed

A staffer can now clear a *"Not certified yet — diver's word"* stamp a stranger left on a diver, and
the act is recorded on the row: `people.no_certification_cleared_at` and
`no_certification_cleared_by_person_id`. The ADR and the column's own docstring both say *"the
correction is not itself invisible."*

On screen it is only half visible. The panel unmounts on success, and what replaces it is one muted
line carrying the **date** — `divers.certifications.noCertificationClearedNote` — and a sentence
saying the who travels in the shop's data export. So the next staffer at the counter can see that
*somebody* overrode a diver's own statement, and cannot see who without asking an owner or manager to
run a full CSV export. For an act one crew member can take about another crew member's diver, in a
record an incident review may later read, the name is the part that matters.

## Why it isn't already done

`no_certification_cleared_by_person_id` is a person id, and turning it into a name needs a join.
`getDiverProfile` (`src/db/divers.ts`) is where that join belongs — it already resolves everything
else the record renders — but that file was another session's path while this shipped, and the
`_components/` on this page take their data as props and read the database nowhere, so resolving it
inside the component would have been the first exception to that rule.

## Proposed change

1. `getDiverProfile` selects the cleared-by person's `fullName` alongside the person row — a
   `leftJoin` on `people` by `no_certification_cleared_by_person_id`, shop-scoped like every other
   read there. Null when nobody cleared it, and null-safe for an erased staff record.
2. `CertificationCards` renders the name in the muted line:
   *"'Not certified yet — diver's word' cleared by Dana Reyes on 21 Jul."* Drop the sentence about
   the export once the name is on screen.
3. Both locales, same change.

**Not** proposed: a second control to *un*-clear it. Re-asserting "this diver holds no card" on the
shop's own authority is a stronger claim than the anonymous form ever made, and the diver can simply
answer the question again — which un-clears the stamp by design.

## Prompt

```text
The staff member who cleared a wrong "not certified yet" stamp is recorded on the row but never
shown. The diver record renders only the date plus a sentence saying the name is in the CSV export,
which is behind the owner/manager export gate — so at the counter nobody can see who overrode a
diver's own statement.

Read first:
  - docs/product/follow-ups/FU-20260815-a-cleared-not-certified-stamp-does-not-name-who-cleared-it.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md — the second 2026-08-15 amendment,
    for why the clear supersedes rather than deletes and why the actor is recorded at all
  - src/db/schema.ts — `people.no_certification_cleared_at` / `_by_person_id` and their docstrings
  - src/db/divers.ts — `getDiverProfile`, where the join belongs
  - src/app/shop/[shopSlug]/divers/[personId]/_components/CertificationCards.tsx — the muted line
    that currently renders the date alone

The work: resolve the cleared-by person to a name in getDiverProfile, render it in that line in both
locales, and drop the "who cleared it travels in the export" sentence once the name is on screen.

Constraints that make this non-obvious:
  - The `_components/` on this page take their data as props and read the database nowhere. Keep it
    that way — the join goes in src/db/divers.ts, not in the component.
  - A cleared-by person may since have been erased (anonymizeDiver blanks the name to a placeholder)
    or soft-deleted. Render what is there rather than hiding the whole line.
  - `no_certification_cleared_by_person_id` deliberately survives a later public re-declaration,
    which nulls `cleared_at` alone. Set-with-null-cleared_at means "corrected once, stated again
    since" — decide whether that state should say anything on screen, and say which way in the ADR.
  - Both locales in the same change (pnpm check:locale).

Done when: pnpm check is green, the diver record names who cleared the stamp, and
docs/product/follow-ups/FU-20260815-a-cleared-not-certified-stamp-does-not-name-who-cleared-it.md
is deleted.
```
