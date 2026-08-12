# FU-20260812-og-card-wordmark-is-copied-four-times — Give the four link-preview cards one wordmark instead of four hand-copied ones

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/og-metadata-issues-jwh67s`, fixing an OG card whose "logo" was a single plain circle
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/app/opengraph-image.tsx`, `src/app/recap/[token]/opengraph-image.tsx`, `src/app/s/[shopSlug]/opengraph-image.tsx`, `src/app/s/[shopSlug]/trips/[id]/opengraph-image.tsx`, `scripts/check-tokens.mjs`, `src/components/Logo.tsx`

## What I noticed

The DiveDay wordmark on every link-preview card — the mark plus "DiveDay." — is written out four
separate times, once per `opengraph-image.tsx`. So is `CARD_STYLE` (the deep-ocean gradient), and so
is the "A calmer way to run a dive day" footer line.

That duplication is what let the mark be wrong everywhere at once and stay wrong: all four cards
rendered a single cyan circle where the brand mark (`src/components/Logo.tsx`, `LogoMark`) is three
ascending bubbles with a coral top. Nobody spotted it because the cards only ever render in someone
else's chat window, and because there was no single place where "this is the logo" was written down —
four copies of a bullet look like a decision. This change fixed all four by hand, which restores the
mark but leaves the same four-way drift risk: the next person to adjust the geometry will adjust one.

## Why it isn't already done

The obvious fix — extract the wordmark to a shared component — collides with `pnpm check:tokens`.
That guard forbids hex literals under `src/app`, `src/components`, and `src/features`, and exempts
exactly Next's metadata filenames (`opengraph-image.tsx`, `icon.tsx`, …) under `src/app`, on the
sound grounds that satori rasterizes to a bitmap where CSS custom properties cannot reach. A shared
`src/app/_og/wordmark.tsx` is the same kind of file for the same reason, but it does not carry one of
those names, so it would fail the check.

There are three ways out and I did not want to pick one as a drive-by on a metadata bug fix:

1. **Extend the exemption** in `scripts/check-tokens.mjs` to a named shared-OG path. Honest — the
   rationale in that script's docstring already covers it — but it widens a guard, which deserves its
   own review rather than riding along with an unrelated fix.
2. **Put the palette in `src/lib`** (e.g. `src/lib/og-brand.ts`, next to the existing
   `src/lib/og-rasterizer.ts`) so the shared JSX carries no hex at all. Passes today's checks
   untouched, but it passes them by moving hex to a root the guard does not scan, which reads as
   sidestepping the rule even where the rule genuinely does not apply.
3. **Leave the duplication** and accept that four cards drift. That is the status quo, and it is what
   produced the bug.

I lean towards (1): the exemption's stated reason is "rendered outside the stylesheet, so tokens
cannot apply", and a shared satori component is precisely that. But it is a guard change, and guard
changes are the human's call.

## Proposed change

Add `src/app/_og/card.tsx` exporting `WORDMARK` (mark + "DiveDay.") and `CARD_STYLE`, and have all
four `opengraph-image.tsx` files import from it. Then take whichever route above the reviewer picks
to make `check:tokens` accept it — for (1), an explicit path allowlist beside `metadataFileNames` in
`scripts/check-tokens.mjs` with a comment naming this file and why.

Not proposed: making the OG cards read design tokens. They cannot — satori has no stylesheet, which
is the whole reason the exemption exists. Also not proposed: deduplicating the *card bodies*. Each
card's layout is genuinely its own (a headline, a shop name, a trip and price, a recap line); only
the chrome repeats.

While there, consider whether `LogoMark`'s 24x24 geometry and the OG copy of it can share a single
list of circle coordinates, so "the mark" has one definition rather than an SVG one and a satori one
that a comment asks you to keep in step.

## Prompt

```text
Read src/app/opengraph-image.tsx, src/app/recap/[token]/opengraph-image.tsx,
src/app/s/[shopSlug]/opengraph-image.tsx, and src/app/s/[shopSlug]/trips/[id]/opengraph-image.tsx.
All four contain a byte-identical WORDMARK constant (a three-bubble mark plus the word "DiveDay")
and a byte-identical CARD_STYLE object. Extract both into one shared module the four files import.

The constraint that makes this non-obvious: `pnpm check:tokens`
(scripts/check-tokens.mjs) forbids hex color literals anywhere under src/app, src/components, and
src/features, and exempts only Next's metadata filenames (opengraph-image.tsx, icon.tsx,
apple-icon.tsx, twitter-image.tsx, manifest.ts) under src/app. A new shared file does not carry one
of those names, so it will fail the check even though it is exempt for exactly the same reason: it
renders through satori to a bitmap, where CSS custom properties cannot reach. Read that script's
docstring before deciding. The recommended route is to extend the exemption with an explicit path
allowlist for the new shared module, documented in the same comment style; do not add the file to
scripts/tokens-baseline.json (the baseline records pre-existing debt, and --write refuses to raise a
count).

Done when: the four cards import one wordmark and one card style, `pnpm check` is green, and each of
the four PNG endpoints still renders correctly — start `pnpm dev` and fetch /opengraph-image,
/s/blue-mantis/opengraph-image, /s/blue-mantis/trips/<id>/opengraph-image, and
/recap/not-a-real-token/opengraph-image, then actually look at the images (the mark is three
ascending bubbles, the top one coral, on a dark gradient). Run `pnpm e2e e2e/seo.spec.ts
--reporter=line`.

Delete docs/product/follow-ups/FU-20260812-og-card-wordmark-is-copied-four-times.md as part of the
change.
```
