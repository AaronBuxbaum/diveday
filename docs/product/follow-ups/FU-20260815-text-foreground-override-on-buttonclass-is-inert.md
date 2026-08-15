# FU-20260815-text-foreground-override-on-buttonclass-is-inert — Decide what a secondary button's label colour is, and make the class say it

- **Status:** Open
- **Raised:** 2026-08-15 — a staff-surface consistency pass that routed the Reports month arrows and the dive-site archive control through `buttonClass`
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/components/ui/button.ts`, `src/app/shop/[shopSlug]/reports/page.tsx`, `src/app/shop/[shopSlug]/courses/page.tsx`, `src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx`

## What I noticed

Around thirty call sites across the staff and marketing surfaces write
`buttonClass({ variant: "secondary", className: "text-foreground" })`, plainly meaning "a bordered
surface button whose label is body text, not link blue". The override does nothing. `secondary`
already carries `text-primary`, and two `text-<color>` utilities resolve by **stylesheet order**,
not by the order they appear in the class attribute — the same trap `button.ts` documents for
`px-*` (`FLUSH`) and for the type scale on the sizes. `src/app/globals.css` declares
`--color-foreground` at line 130 and `--color-primary` at line 133, so Tailwind emits
`.text-primary` *after* `.text-foreground` and primary wins.

I confirmed it by compiling the repo's real `globals.css` through this repo's own
`@tailwindcss/postcss` 4.3.3 and reading the byte offsets of the emitted rules:
`.text-foreground` at 5182, `.text-muted` at 5237, `.text-primary` at 5282. Later wins, so every
one of those buttons renders its label in primary blue and always has.

Nothing is broken on screen — the app has looked like this since the override was first written —
but a class string that reads as an instruction and is silently ignored is how the next person
spends an hour on a colour that will not change. The same shape appears with `text-muted`: a
disabled month arrow asking for muted also renders primary, at 40% opacity.

## Why it isn't already done

Two reasons. It is outside the scope I was given (a presentation pass over named staff surfaces,
not a design-token decision), and more importantly the fix requires a call I should not make
alone: either the ~30 sites genuinely want a body-text label, in which case `secondary` is
mis-specified and its own `text-primary` should change — which moves pixels on every secondary
button in the product, including the marketing pages — or `secondary` is right as it stands and the
overrides are cargo-cult and should simply be deleted. Both are one-line changes with a
product-wide visual diff behind them, and they are opposite changes.

I did not want to encode a guess in a thirty-file sweep, so the two controls I touched
(`reports/page.tsx`'s month arrows, `courses/page.tsx`'s empty-state door) use plain `secondary`
with no inert override and a comment saying why.

## Proposed change

Decide first, then make the class honest:

- **If a secondary button's label should be body text**, change `variants.secondary` in
  `src/components/ui/button.ts` from `text-primary` to `text-foreground`, delete every
  `className: "text-foreground"` that exists only to override it, and account for the visual diff
  across the staff app and `/pricing`, `/product`, `/switching/*`.
- **If it should stay primary-toned**, delete those same overrides and nothing else. Either way the
  end state is that no call site passes a `text-<color>` through `className` to `buttonClass`.

Then close the gap that let this happen: `button.ts` already explains the ordering trap for
horizontal padding and for the type scale, and `button.test.ts` pins both halves of the `px-*`
split. Add the colour case to that docblock, and — the part that actually prevents a repeat — make
`buttonClass` reject a `className` containing a bare `text-<color>` token, in a unit test rather
than at runtime, the same way `check-tokens.mjs` polices raw hex.

Do **not** "fix" this by appending Tailwind's `!` important suffix at the call sites. That papers
over one instance of an ordering rule the file already decided to solve structurally (a named
option, `flush`, rather than a class the caller passes), and it would leave the next colour
override just as silently inert.

## Prompt

```text
In the DiveDay repo, `buttonClass({ variant: "secondary", className: "text-foreground" })` is used
at roughly thirty call sites and the override does nothing: `secondary` already carries
`text-primary`, and two `text-<color>` utilities resolve by stylesheet order rather than by the
order they were written. `src/app/globals.css` declares `--color-foreground` before
`--color-primary`, so `.text-primary` is emitted later and wins.

Read `src/components/ui/button.ts` first — its `FLUSH` docblock and the note above `sizes` already
explain this exact trap for horizontal padding and for the type scale, which is the reasoning to
follow. Then `grep -rn 'text-foreground' src | grep buttonClass` for the call sites.

You can verify the ordering claim without guessing: compile `src/app/globals.css` through this
repo's own `@tailwindcss/postcss` against a scratch HTML file containing the class names, and
compare the byte offsets of the emitted `.text-foreground` / `.text-muted` / `.text-primary` rules.
Later offset wins.

This needs a product decision before any code moves, so start by asking the human which of the two
end states they want:
  (a) a secondary button's label is body text — change `variants.secondary` to `text-foreground`
      and delete the now-redundant overrides; this moves pixels on every secondary button in the
      staff app and on /pricing, /product and /switching/*, so it needs visual-diff triage.
  (b) a secondary button's label stays primary-toned — delete the overrides and change nothing else.

Under either answer, done means: no call site passes a `text-<color>` through `className` to
`buttonClass`; `src/components/ui/button.ts`'s docblock names the colour case alongside the padding
and type-scale ones; and `src/components/ui/button.test.ts` has a case that fails if a
`text-<color>` token appears in a `className` handed to `buttonClass`. Do not reach for Tailwind's
`!` important suffix — this file solves ordering with named options, not with escape hatches at the
call site.

Run `pnpm check` and `pnpm test src/components/ui/button.test.ts --reporter=dot`. Under (a), also
run `pnpm visual` and account for every diff in the PR description. Delete
docs/product/follow-ups/FU-20260815-text-foreground-override-on-buttonclass-is-inert.md as part of
the change.
```
