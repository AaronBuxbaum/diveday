# FU-20260815-the-not-certified-eraser-has-no-e2e-or-visual-cover — Photograph and click the two new diver-record states

- **Status:** Open
- **Raised:** 2026-08-15 — closing the three
  ADR 20260814-self-declared-cards follow-ups (refusal copy, the eraser, the contacts.csv column).
  The session that built them was scoped out of `e2e/` and `src/app/api/test/` because other
  sessions owned those paths at the time.
- **Kind:** half-done
- **Effort:** S
- **Touches:** `e2e/visual.spec.ts`, `e2e/`, `src/app/api/test/seed-trouble-states/route.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/_components/CertificationCards.tsx`

## What I noticed

Two states now render on the staff diver record that no screenshot has ever looked at and no
Playwright spec ever clicks:

- **The "Not certified yet — diver's word" panel** (`CertificationCards.tsx`) — a warning-toned
  `SectionCard` with a "They never said that" button, shown only when
  `people.no_certification_declared_at` is set, no staffer has cleared it, and no live card refutes
  it. It is a block of warning-toned prose a shop sees on a day something is wrong about a diver's
  record, which is exactly the class AGENTS.md says goes through
  `/api/test/seed-trouble-states` rather than into the demo shop.
- **The refused card sighting** — typing `xx` into the card-sighting form now re-opens the
  `<details>` with a field-level error under the number box (`card-number-implausible`) and the
  cursor moved to it. Unit tests cover the action's redirect and that nothing is written
  (`src/app/shop/[shopSlug]/divers/[personId]/card-sighting.action.test.ts`); nothing proves the
  *page* renders the error in the right place, which is the whole point of the change — a refusal
  rendered inside a shut disclosure is invisible.

Both were verified by unit test and by reading, not by looking, so a layout regression in either is
currently silent.

## Why it isn't already done

Path ownership. Seven sessions were working in this directory concurrently and the one that made
this change was told explicitly not to touch `e2e/**`; `src/app/api/test/seed-trouble-states/` was
not in its lane either. Adding a capture also means deciding whether the stamp goes into that route
(it should — a demo shop permanently claiming a diver is uncertified is a worse demo, and
`src/db/seed-front-desk.ts` records that reasoning at the row where it deliberately seeds a healthy
state).

## Proposed change

1. Add the declared-uncertified state to `src/app/api/test/seed-trouble-states/route.ts`: set
   `people.no_certification_declared_at` on one diver of the shared fixture who holds no card, so the
   panel renders.
2. A `e2e/visual.spec.ts` capture of the diver record in that state, beside its calm one.
3. One functional spec covering the two flows end to end: type `xx` into a card sighting and assert
   the error renders **on the number field with the disclosure still open**, then type a real number
   and assert the card certifies; and clear a wrong stamp and assert the panel disappears and the
   confirmation renders.
4. Add both routes/captures to `scripts/route-coverage.json` if the diver record's entry does not
   already cover them.

**Not** proposed: seeding the stamp into `blue-mantis` itself, or a `?filter=` that shrinks the
diver-record capture — that page is long, and if it screenshots enormous the answer is pagination in
the product.

## Prompt

```text
Two new states on the staff diver record have no visual capture and no e2e spec: the warning-toned
"Not certified yet — diver's word" panel with its "They never said that" button, and the field-level
refusal a card sighting shows when the number is not a card number. Both shipped with unit tests and
were verified by reading rather than by looking.

Read first:
  - docs/product/follow-ups/FU-20260815-the-not-certified-eraser-has-no-e2e-or-visual-cover.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md — the second 2026-08-15 amendment,
    which is what shipped these two states
  - src/app/shop/[shopSlug]/divers/[personId]/_components/CertificationCards.tsx and
    _components/CardSightingForm.tsx — the two surfaces
  - src/app/shop/[shopSlug]/divers/[personId]/card-sighting.action.test.ts — what is already proven
    at the action layer, so the spec does not repeat it
  - src/app/api/test/seed-trouble-states/route.ts — where a state that only renders when something
    is wrong gets seeded for a screenshot
  - the e2e-and-visual skill

The work: seed the declared-uncertified state through /api/test/seed-trouble-states, add a
e2e/visual.spec.ts capture beside the record's calm one, and one functional spec that types "xx"
into a card sighting and asserts the error lands on the number field with the disclosure still open,
then certifies with a real number, then clears a wrong stamp and asserts the panel goes away.

Constraints that make this non-obvious:
  - Never seed this into blue-mantis: a demo shop permanently claiming a diver is uncertified is a
    worse demo (src/db/seed-front-desk.ts says so at the row it deliberately seeds healthy).
  - pnpm check:e2e-hygiene refuses timing guesses — wait for what the destination renders, never a
    waitForTimeout or networkidle.
  - Screenshots are full-size and unfiltered. If the diver record screenshots enormous, that is the
    page telling you it is unbounded; do not narrow the capture.

Done when: pnpm check is green, the focused spec passes, the capture is in e2e/visual.spec.ts,
scripts/route-coverage.json still passes, and
docs/product/follow-ups/FU-20260815-the-not-certified-eraser-has-no-e2e-or-visual-cover.md is deleted.
```
