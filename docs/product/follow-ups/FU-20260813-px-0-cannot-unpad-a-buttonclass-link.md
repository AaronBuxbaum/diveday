# FU-20260813-px-0-cannot-unpad-a-buttonclass-link — Three marketing links pass a `px-0` that Tailwind ignores

- **Status:** Open
- **Raised:** 2026-08-13 — the `/product` design pass, measuring left edges in the page capture
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/page.tsx`, `src/app/pricing/page.tsx`, `src/components/ui/button.ts`,
  `docs/design/forms-and-controls.md`

## What I noticed

`buttonClass({ variant: "link", className: "px-0" })` does not remove the padding.

`buttonClass` composes `${base} ${variants[variant]} ${sizes[size]} ${className}`, so the string
ends up as `… px-4 … px-0`. Class order in the attribute decides nothing — the stylesheet does,
and Tailwind emits `.px-0` **before** `.px-4`. Measured in this branch's build
(`.next/static/chunks/*.css`): `.px-0` at byte 43048, `.px-4` at 43351. The later rule wins, so the
link keeps its 16px of horizontal padding.

Three call sites believe otherwise, and each renders a link that sits 16px right of the copy it
belongs under:

- `src/app/page.tsx:289` — `buttonClass({ variant: "link", className: "mt-2 px-0" })`
- `src/app/page.tsx:383` — `buttonClass({ variant: "link", className: "mt-10 px-0 text-left" })`
- `src/app/pricing/page.tsx:281` — `buttonClass({ variant: "link", className: "mt-2 px-0 text-left" })`

`/product` had the same misalignment in its closing band (the "On a spreadsheet today?" link, 17px
right of the heading above it, which is how I found this) and in the pricing link its money band
gained. Both are fixed there with `-ml-4` — the
same move `src/components/JumpNav.tsx` already makes with `-ml-3` for its `sm`-size links, pulling
the box left by exactly its own padding so the label lines up while the touch target survives.

## Why it isn't already done

`/` and `/pricing` are other pages, and this design sweep has had a branch per surface — editing
two files I do not own to fix a 16px indent is the kind of drive-by that produces merge conflicts
with whoever is redesigning them. The fix is also arguably not "add `-ml-4` in three more places":
four call sites reaching for the same workaround say the wrapper is missing a way to say it,
which is a `src/components/ui/button.ts` API call and belongs with a look at
`docs/design/forms-and-controls.md` rather than in a page diff.

## Proposed change

Give `buttonClass` a size (or a flag) that means "reads as inline text, keeps the touch target,
claims no horizontal box" — e.g. a `flush: true` option that swaps the size's `px-*` for `-mx-*`
of the same amount, so the label's optical left edge is the container's. Then move the sites
onto it and delete the `-ml-4` comment on `/product`.

Not proposed: `px-0!` / `!px-0`. It would work, but it teaches the next reader that fighting the
wrapper with `!important` is normal, and the wrapper exists precisely so call sites stop
hand-tuning button geometry.

## Prompt

```text
`buttonClass({ variant: "link", className: "px-0" })` silently does nothing: buttonClass composes
`${base} ${variants} ${sizes} ${className}`, and Tailwind emits `.px-0` before `.px-4`, so the
size's padding wins regardless of the order in the class attribute. Verify it yourself before
changing anything — build (`pnpm e2e:build`) and grep the emitted `.next/static/chunks/*.css` for
the byte offsets of `.px-0{` and `.px-4{`.

Three call sites rely on it and render a link indented 16px past the copy above it:
src/app/page.tsx:289, src/app/page.tsx:383 and src/app/pricing/page.tsx:281.
src/app/product/page.tsx works around it with `-ml-4` in two places, and src/components/JumpNav.tsx
does the same with `-ml-3`.

Read src/components/ui/button.ts and docs/design/forms-and-controls.md first. Add one way to
express "inline-text link, full touch target, no horizontal box" to buttonClass — a `flush` option
that trades the size's `px-*` for a matching negative margin — document it in
docs/design/forms-and-controls.md, and move all five call sites onto it (the three above, the
product page's `-ml-4`, and JumpNav's `-ml-3`). Do not reach for `!important`.

Done when: `pnpm check` is green, and the marketing captures show each link's label sharing a left
edge with the heading above it — capture with
`E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g 'landing|pricing|product' --reporter=line`
and read the PNGs in e2e/screenshots/. Delete
docs/product/follow-ups/FU-20260813-px-0-cannot-unpad-a-buttonclass-link.md as part of the change.
```
