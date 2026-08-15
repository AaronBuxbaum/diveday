# FU-20260815-two-orders-skeletons-paint-cards-the-page-never-renders — Make the two Orders skeletons the shape of the pages they stand in for

- **Status:** Open
- **Raised:** 2026-08-15 — found while migrating `trips/`, `divers/` and `orders/` onto
  `SectionCard` (branch `follow-ups/round-two`, one cluster of
  FU-20260815-section-card-migration-beyond-settings)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/orders/[id]/loading.tsx`,
  `src/app/shop/[shopSlug]/orders/new/loading.tsx`, `src/app/shop/[shopSlug]/orders/new/page.tsx`

## What I noticed

Two of the three Orders skeletons paint a card the page underneath them does not have, so every
navigation into those routes ends in a layout jump — the exact thing a `loading.tsx` exists to
prevent (ADR 20260804-instant-navigation).

- **`orders/[id]/loading.tsx`** paints *two* cards: a padded one for the receipt, then a bare
  `h-32` one under it. `orders/[id]/page.tsx` renders exactly one `<section>` and nothing else —
  there is no second panel, no refund-history table, no `<Table>`. (Grep it: the file has one
  `<ul>` and no `<section>` besides the receipt.) The skeleton's own docstring still says "line
  items, payment state, **and refund history**", so the second block is a leftover from a panel
  that was removed. A staffer opening an order watches a second card fade in and then vanish.
- **`orders/new/loading.tsx`** paints one padded card holding four label/control pairs.
  `orders/new/page.tsx` has **no card at all** — the form is a bare
  `<form className="flex flex-col gap-6">` with a `FieldGrid` and a `<fieldset>` directly on the
  page background. The skeleton promises a bordered panel that never arrives, so the whole form
  appears to lose its frame the instant it loads.

## Why it isn't already done

Outside the scope I was given. My task was the section-card migration for three route trees:
replace hand-typed panel classes with `SectionCard` / `sectionCardClass()`, and move each route's
`loading.tsx` with its page. I did that — both files now take their shell from
`sectionCardClass()` rather than a hand-typed `rounded-2xl border border-border bg-surface p-6` —
which fixes the *radius and padding* drift but deliberately does not change **how many** cards
each skeleton has, or whether `orders/new` should have one.

That second question is a call about page shape, not about card vocabulary, and it has two
defensible answers for `orders/new` (below). Deleting a block from someone else's skeleton on the
way past, in a change whose whole point is a reviewable visual diff, seemed like the wrong way to
decide it.

## Proposed change

**`orders/[id]/loading.tsx`** — no judgement needed: delete the trailing
`<div className={sectionCardClass({ padding: "none", className: "mt-6 h-32" })} />` and drop
"and refund history" from the docstring. The page has one card; the skeleton should have one card.

**`orders/new/loading.tsx`** — pick one, don't split the difference:

1. *Give the page the card.* Wrap `orders/new/page.tsx`'s `<form>` in
   `<SectionCard padding="lg">`. This is what every other staff form-page does (the settings
   routes, `divers/page.tsx`'s add-diver disclosure, `RentalFit`), and it makes the existing
   skeleton correct as-is. **Recommended** — a bare form on the page background is the odd one out
   in the staff app now that the rest of it is carded.
2. *Take the card off the skeleton.* Replace the `sectionCardClass` wrapper with a plain
   `<div className="mt-8">` holding the same label/control bars.

Do **not** keep both as they are, and do **not** add a `padding` value or a `radius` prop to
`sectionCardClass` to make the two ends meet — that is the drift-behind-an-abstraction the card
component's own doc comment refuses.

## Prompt

```text
Two Orders skeletons in DiveDay paint a card the page underneath never renders, so navigating into
those routes ends in a layout jump.

Read first: src/components/ui/card.tsx (the SectionCard / sectionCardClass API and its doc
comment), the "Cards: SectionCard" section of docs/design/forms-and-controls.md, and then these
four files side by side:
  src/app/shop/[shopSlug]/orders/[id]/loading.tsx   vs  .../orders/[id]/page.tsx
  src/app/shop/[shopSlug]/orders/new/loading.tsx    vs  .../orders/new/page.tsx

A route's loading.tsx IS the segment's <Suspense> boundary and must be shaped like the body it
replaces (AGENTS.md hard rule, ADR 20260804-instant-navigation). Both skeletons already take their
chrome from sectionCardClass(), so radius and padding are right; what is wrong is the number of
cards.

Do:
1. orders/[id]/loading.tsx paints two cards; the page renders exactly one <section>. Delete the
   trailing h-32 card and drop "and refund history" from the docstring.
2. orders/new/loading.tsx paints a padded card; the page's form sits on the bare page background
   with no card at all. Fix by wrapping that form in <SectionCard padding="lg"> in
   orders/new/page.tsx — the shape every other staff form-page uses — rather than by stripping the
   skeleton. If you disagree after looking at both, strip the skeleton instead, but pick one; do
   not leave them disagreeing.

Do NOT add a `radius` prop, a per-call-site `padding`, or a second softer card to make these meet.

Done when: each skeleton has the same number of cards, at the same padding, as the page it stands
in for; `pnpm check` is green; and `pnpm e2e e2e/orders.spec.ts --reporter=line` passes. Expect the
`orders-new` and `order-detail` visual captures to move if you take option 1 — say in the PR that
the form gained the card its skeleton always promised. Delete
docs/product/follow-ups/FU-20260815-two-orders-skeletons-paint-cards-the-page-never-renders.md as
part of the change.
```
