# FU-20260813-homepage-link-button-px-override — one homepage link still asks for `px-0` and renders indented; convert it to `flush`

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-pricing-page`, which added the `flush` option to `buttonClass` and converted `/pricing`'s three call sites
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/page.tsx`, `src/components/ui/button.ts`, `docs/design/forms-and-controls.md`

## What I noticed

`buttonClass({ variant: "link", className: "px-0" })` does not produce `px-0`. The size (`md` by
default) bakes `px-4` into the class list, and two utilities for the same property resolve by
**stylesheet** order rather than the order they appear in the attribute — Tailwind emits `px-0`
before `px-4`, so the size always wins and the label renders 16px indented from whatever it was
meant to line up with.

`src/components/ui/button.ts` already documented this trap for font sizes ("Two competing font-size
utilities in one class list resolve by stylesheet order, not by the order you wrote them"). It now
documents it for padding too, and carries a `flush` option that drops the size's horizontal padding
properly, with unit tests in `src/components/ui/button.test.ts`.

`/pricing` had three of these and is converted. One call site remains:
`src/app/page.tsx:227`, `buttonClass({ variant: "link", className: "px-0" })`. It renders indented
today, and the `px-0` in its source says an author already noticed and thought they had fixed it.

## Why it isn't already done

The homepage was owned by a different work scope in the same batch of marketing-design branches,
and it is the site's most-reviewed screen — an unexplained pixel shift there lands in a visual
baseline someone else is mid-triage on. It also needs a judgement my branch could not make from
outside: whether that particular link *wants* to be flush at all. It may sit in a row beside real
buttons, where the padding is correct and the `px-0` was the mistake.

## Proposed change

Look at what `src/app/page.tsx:227`'s link is meant to align with in the rendered page, then either:

- convert it to `buttonClass({ variant: "link", flush: true })` and account for the ~16px shift in
  the PR's visual-diff notes; or
- delete the dead `className: "px-0"` and leave the padding, if the link belongs in a button row.

Either way the misleading no-op override goes. While there, add the padding trap to
[docs/design/forms-and-controls.md](../../design/forms-and-controls.md) next to whatever it says
about `buttonClass` — `button.ts`'s docstring carries it, the design doc does not.

Not proposed: a repo-wide sweep. A grep for `variant: "link"` across `src/` finds this one
remaining `px-*` override; the rest pass no padding at all and are fine.

## Prompt

```text
In the DiveDay repo, src/app/page.tsx:227 calls
`buttonClass({ variant: "link", className: "px-0" })`. That override does nothing: the size's own
`px-4` wins, because two utilities for one property resolve by stylesheet order and Tailwind emits
px-0 before px-4. The link therefore renders ~16px indented from whatever it is meant to align
with, and the `px-0` in the source makes it look like someone already fixed it.

`buttonClass` (src/components/ui/button.ts) now has a `flush: true` option that drops the size's
horizontal padding correctly, keeping min-h-11 and the vertical padding; see
src/components/ui/button.test.ts and the three converted call sites in src/app/pricing/page.tsx.

Read first: src/components/ui/button.ts (the docstrings explain why the padding and min-height
exist), then src/app/page.tsx around line 227 — look at the rendered homepage and decide what that
link is supposed to line up with.

Do this: either convert it to `flush: true` (if it should sit flush with adjacent prose) or drop
the dead `className: "px-0"` (if it belongs in a row beside real buttons and the padding is
right). Then add the padding trap to docs/design/forms-and-controls.md beside its existing
buttonClass guidance.

Done means pnpm check is green and, if you changed the rendering, the homepage visual diff is named
and explained in the PR:
  pnpm e2e:build
  E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g 'home' --reporter=line
and read the PNGs in e2e/screenshots/ rather than assuming.

Delete docs/product/follow-ups/FU-20260813-homepage-link-button-px-override.md as part of the change.
```
