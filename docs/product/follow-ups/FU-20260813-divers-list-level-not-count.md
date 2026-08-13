# FU-20260813-divers-list-level-not-count — Should the roster's Cards column show the level instead of the count?

- **Status:** Open
- **Raised:** 2026-08-13 — design survey on branch claude/app-design-overhaul-g0ksof
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/divers/_components/DiverList.tsx`, `src/db/divers.ts`

## What I noticed

The Divers roster's second column is a card *count* — and on the demo roster its value is `1` on
nearly every row (`0` or `2` on a handful). A column whose usual value repeats down the page is
the shape principle 9 warns about, and the count answers a question staff rarely ask ("how many
cards?") while the question they do ask at booking time — "what level is this diver?" — still
costs a click into the record. The list already went through a deliberate principle-9 pass
(muted count, badges only for pending/unconfirmed cards — see the comments in `DiverList.tsx`),
so this is not an oversight; it is a question about which fact the column should carry.

## Why it isn't already done

It needs a product judgement I didn't want to make unilaterally while the current cell is a
documented, deliberate choice: the highest card is not always the *relevant* card (an expired
rescue card outranks a valid OW card in level but not in usefulness), so "show the level" needs a
rule for which card speaks — probably the same one `diverDepthLimit` already applies
(src/db/readiness.ts). Rendering agency levels also touches the certification-label i18n that the
diver record already solved; the list should reuse that, not invent a second mapping. Safe to
show a dive-domain-expert before shipping.

## Proposed change

Replace the bare count with the diver's highest *currently valid* certification level (falling
back to the count only when it says something, i.e. `0` → "No cards on file" styling stays as-is),
keeping the pending/unconfirmed badges exactly as they are. If the level rule turns out to be
contested, the cheaper alternative is dropping the column entirely on desktop — name and contact
already identify the person, and the filter chips carry the attention states.

## Prompt

```text
Read docs/design/principles.md (#9, #10), src/app/shop/[shopSlug]/divers/_components/DiverList.tsx,
and how src/db/readiness.ts picks the card that governs a diver (diverDepthLimit and the
certification-level ordering). Decide with a dive-domain-expert review whether the roster's Cards
column should show the diver's highest currently valid certification level instead of a card
count, then implement the chosen answer: the level text must come from the same level-label
source the diver record uses (never a second mapping), the pending/unconfirmed badges stay, and
the summary query in src/db/divers.ts grows whatever field the cell needs in the same page-shaped
read (no per-row queries). Update the divers visual captures and run pnpm check plus
pnpm e2e:run e2e/divers.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260813-divers-list-level-not-count.md as part of the change.
```
