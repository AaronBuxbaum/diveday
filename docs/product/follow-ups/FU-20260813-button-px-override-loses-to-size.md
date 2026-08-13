# FU-20260813-button-px-override-loses-to-size — a `px-0` passed to `buttonClass` does nothing; flush link buttons are indented 16px

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-pricing-page`, while aligning `/pricing`'s "See everything it does, in detail →" link with the checklist above it
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/components/ui/button.ts`, `docs/design/forms-and-controls.md`, `src/app/page.tsx`, `src/app/pricing/page.tsx`

## What I noticed

`buttonClass({ variant: "link", className: "px-0" })` renders with `px-4`, not `px-0`. The size
(`md` by default) bakes `px-4` into the class list and the `className` string is appended after it,
but two utilities for the same property resolve by **stylesheet** order, not by the order they
appear in the attribute — and Tailwind emits `px-0` before `px-4`, so the size always wins.

`src/components/ui/button.ts` already documents this hazard for font sizes ("Two competing
font-size utilities in one class list resolve by stylesheet order, not by the order you wrote
them"). The same trap applies to padding, and nothing says so.

It is measurable rather than theoretical. On `/pricing` before this branch's fix, the
`className: "mt-4 -ml-1 px-1"` link sat at x=293 while the checkmarks it was meant to line up with
sat at x=281 — 12px of unexplained indent, read off the rendered PNG
(`e2e/screenshots/pricing-light-vw-1280.png`). A reader sees a bulleted list whose closing link is
mysteriously inset from the bullets.

`src/app/pricing/page.tsx` had three of these and is fixed on this branch, by moving the offset to
a wrapper `div` (`-ml-4`) where nothing competes for it. One call site still makes the ineffective
request: `src/app/page.tsx:227`, `buttonClass({ variant: "link", className: "px-0" })` — the
homepage renders it indented by 16px from whatever it was meant to align with.

## Why it isn't already done

Out of scope: my unit owned `src/app/pricing/page.tsx` and its message keys, and the real fix is a
change to the shared `buttonClass` contract plus an audit of every call site that assumed the
override worked. The wrapper-`div` workaround I used is correct but is a workaround — it hard-codes
knowledge that the default size's padding is `px-4`, so a size change silently breaks the
alignment again.

I also do not want to guess at the API. There are at least three shapes and they are not
equivalent:

1. A `flush` (or `size: "inline"`) option on `buttonClass` that emits `px-0` **instead of** the
   size's padding, keeping the `min-h-11` touch target. Cleanest, and makes the intent explicit.
2. Make `buttonClass` strip any size utility whose property the caller's `className` also sets.
   Clever, and fragile — it would have to parse class strings.
3. Leave the API alone and document the wrapper-`div` pattern as the house rule.

I would pick (1): the request "this link should sit flush with the text beside it" is a real,
recurring layout intent, and a named option makes it reviewable, whereas `px-0` in a `className`
looks like it works and does not.

## Proposed change

Add a `flush?: boolean` to `buttonClass` that replaces the size's horizontal padding with `px-0`
(the `min-h-11` and `inline-flex` centering stay — the touch target is the reason the padding is
there, and vertical padding still supplies it). Then:

- convert the remaining `px-0` call site (`src/app/page.tsx:227`) to `flush: true` and delete the
  dead override — check what it is supposed to align with before assuming flush is right there;
- convert `src/app/pricing/page.tsx`'s three wrapper `div`s (`-ml-4`) back to `flush: true`, which
  is what they are emulating;
- add a line to the `button.ts` docstring and to
  [docs/design/forms-and-controls.md](../../design/forms-and-controls.md) saying padding overrides
  passed through `className` lose to the size, same as font size;
- verify by re-measuring, not by eye: a link and the text above it should start on the same x in
  `e2e/screenshots/pricing-light-vw-1280.png`.

Not proposed: removing padding from the `link` variant globally. Some link-variant buttons sit in
rows beside real buttons and want the same hit area and spacing.

## Prompt

```text
In the DiveDay repo, `buttonClass` (src/components/ui/button.ts) bakes a horizontal padding into
every size (`md` is `px-4`). Several call sites try to cancel it by passing `className: "px-0"` so
a link-variant button lines up flush with the text above it. That does not work: two utilities for
the same property resolve by stylesheet order, and Tailwind emits `px-0` before `px-4`, so the
size wins and the link renders 16px indented. The file's own docstring already warns about exactly
this for font sizes; padding has the same trap and is undocumented.

Read first: src/components/ui/button.ts (the whole file, including the docstrings — they explain
why the padding and min-height exist), docs/design/forms-and-controls.md, and
src/app/pricing/page.tsx (which works around it today with wrapper `div`s carrying `-ml-4`).

Do this:
1. Add a `flush?: boolean` option to `buttonClass` that swaps the size's horizontal padding for
   `px-0` while keeping `min-h-11` and the inline-flex centering.
2. Grep for `variant: "link"` across src/ and convert every `px-0` / `px-1` / `-ml-*` alignment
   hack to `flush: true`, including the three wrapper `div`s in src/app/pricing/page.tsx.
3. Document the padding trap in the button.ts docstring and in
   docs/design/forms-and-controls.md, next to the existing font-size note.
4. Add a unit test asserting `buttonClass({ variant: "link", flush: true })` contains no `px-4`.

Done means: `pnpm check` is green, and a rebuilt `/pricing` capture shows the "See everything it
does, in detail →" link starting on the same x as the checkmarks above it. Measure it off the PNG
rather than judging by eye:
  pnpm e2e:build
  E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g 'pricing' --reporter=line
then read e2e/screenshots/pricing-light-vw-1280.png. Explain the (small, intentional) visual diff
in the PR.

Delete docs/product/follow-ups/FU-20260813-button-px-override-loses-to-size.md as part of the change.
```
