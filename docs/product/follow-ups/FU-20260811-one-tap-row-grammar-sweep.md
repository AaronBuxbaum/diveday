# FU-20260811-one-tap-row-grammar-sweep — Audit the remaining staff lists for the one-tap row grammar

- **Status:** Open
- **Raised:** 2026-08-11 — the check-in queue's move onto the roll-call row grammar (branch
  `claude/app-design-overhaul-n68zhb`)
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/guests/`, `src/app/shop/[shopSlug]/divers/page.tsx`,
  `docs/design/principles.md`

## What I noticed

The app now has a strong, consistent grammar for working lists of people: one line per person, the
whole row is the control, re-tap undoes, and the trailing slot spells out state in words plus a
shape. Three surfaces speak it — the manifest roll call (PR #449), the Today queue's stretched-link
rows, and now the counter check-in. Other staff lists predate the grammar and were not audited in
this change: the trip's Guests roster (per-diver cards with button stacks), the walk-in picker's
person results, and any list where a row's one common action still renders as a bordered per-row
button beside a row that does nothing. Where such a list exists, it now reads as the odd one out —
a staffer who has learned "tap the person" at the counter and the rail will tap the person on the
roster too, and nothing will happen.

## Why it isn't already done

Outside the scope of the check-in redesign, and not mechanical: each surface has to be judged on
its own dominant action (the Guests roster is a mixed read/fix surface where "the one tap" is less
obvious than at the counter), and some rows carry consequential actions (sends, refunds) that
principle 7 says must stay explicit buttons. A sweep that blindly rowifies everything would be the
novelty-for-its-own-sake failure principle 11 warns about.

## Proposed change

Screenshot each staff list surface (the verify skill's tooling), ask for each: does this list have
one dominant per-row action a whole-row tap should own, and is its current control a repeated
same-weight button? Convert the ones that qualify, one surface per PR, reusing the
`QueueRowButton` shape (or promoting it to `src/components/` first). Explicitly not proposing:
rows whose action is a send or a payment (principle 7 keeps those explicit), or the public diver
pages (different audience, already link-grammar).

## Prompt

```text
Read docs/design/principles.md (§7, §8, §10), src/app/shop/[shopSlug]/check-in/page.tsx and its
QueueRowButton.tsx, and src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx
to learn the one-tap row grammar three surfaces now share. Then audit the remaining staff list
surfaces (start with the trip Guests roster and the walk-in person picker) with screenshots from
node scripts/screenshot.mjs against a running pnpm dev. For each list decide whether it has one
dominant per-row action that should become a whole-row tap with re-tap undo, and convert only
those that qualify — never a row whose action is a send, refund, or other consequential act, which
principle 7 keeps as explicit buttons. One surface per PR, each with e2e + visual coverage per the
e2e-and-visual skill, pnpm check green, light and dark screenshots reviewed. Delete
docs/product/follow-ups/FU-20260811-one-tap-row-grammar-sweep.md when the sweep is complete.
```
