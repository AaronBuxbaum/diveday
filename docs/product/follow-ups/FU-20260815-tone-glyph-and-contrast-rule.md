# FU-20260815-tone-glyph-and-contrast-rule — Settle whether success/warning text on a tinted fill needs `-strong`, and stop declaring the tone glyphs three times

- **Status:** Open
- **Raised:** 2026-08-15 — the app-wide consistency sweep on `worktree-bridge-cse_015vZRaiUc7FVWBrtgdhSeER`
- **Kind:** question
- **Effort:** M
- **Touches:** `src/components/ui/badge.tsx`, `src/components/ui/form.tsx`, `src/components/ShopPageHeader.tsx`, `docs/design/forms-and-controls.md`

## What I noticed

**Two files disagree about a contrast measurement, in writing.**

`src/components/ui/badge.tsx:10-14` says `text-success`/`text-warning` on their own tinted fill
measured *just under* AA at badge text sizes, and therefore uses `text-success-strong` /
`text-warning-strong`. `src/components/OfflineFreshnessPill.tsx:3-5` and `ShopPageHeader.tsx:139-140`
(the stat tile) repeat that reasoning and also use `-strong`.

But `src/app/shop/[shopSlug]/_components/today/KindChip.tsx:16-20` states the opposite — that
warning on `bg-surface` measures **5.02:1 and passes** — and these all use the plain, un-`-strong`
token on a tint:

- `src/components/ui/form.tsx:283` (`FormStatus`'s `STATUS_TONE`)
- `src/components/ShopPageHeader.tsx:261` (`ShopNotice`)
- `src/app/waivers/[token]/page.tsx:872`
- `src/app/ready/[token]/page.tsx:77`
- `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx:96,102`

So the same hue-on-tint pairing is documented as failing AA in three files and passing in one, and
roughly eight surfaces render the version the first three call sub-AA. Someone measured; the two
results were never reconciled. Note the two claims are not strictly contradictory — one is about a
*tinted* fill, the other about `bg-surface` — which is exactly why it needs one written answer
rather than another reading.

**The ✅⚠️❌ set is declared three times**, in three files that cite each other in comments and none
of which imports: `badge.tsx:36-40` (`toneGlyph`), `form.tsx:295-299` (`STATUS_GLYPH`), and
`ShopPageHeader.tsx:236-241` (`NOTICE_GLYPH` — this one with a trailing space baked into the string
where the other two use `gap-1`).

## Why it isn't already done

The glyph de-duplication is trivial and I would have done it, but it is not worth touching those
three files twice — it should land in the same change as the contrast answer, which I cannot give.
That one needs a real measurement against the current token values in `src/app/globals.css`, in both
light and dark themes, and a decision recorded somewhere durable. Guessing would mean either
recolouring eight surfaces on my own say-so, or writing "leave it" into a doc on no evidence.

This is a question, so: my recommendation is to measure and then move *everything* to `-strong` on a
tint. The failure mode is asymmetric — `-strong` is the same hue nudged darker, so adopting it
everywhere costs a barely perceptible shift and buys a guarantee, while being wrong the other way is
an accessibility defect on `FormStatus`, which is the component that tells a staffer their save was
refused.

## Proposed change

1. Measure `text-success` / `text-warning` against `bg-success/10` / `bg-warning/10` **and** against
   `bg-surface`, in light and dark, using the values in `src/app/globals.css`. Record the numbers in
   `docs/design/forms-and-controls.md` beside the existing tone guidance — numbers, not prose, so
   the next person does not re-litigate it.
2. Sweep the ~8 sites above to whichever token the measurement supports, and correct whichever of
   `badge.tsx:10-14` or `KindChip.tsx:16-20` turns out to be wrong. One of those comments is
   currently misleading a reader.
3. Export the glyph map once — `toneGlyph` from `badge.tsx`, or a new `src/components/ui/tone.ts` —
   and have `form.tsx` and `ShopPageHeader.tsx` import it. Delete the two copies. Keep the trailing
   space out; the consumers use `gap-1`.

Do **not** change what the glyphs *are*. Emoji rather than text dingbats was a deliberate call
argued at length in `badge.tsx:22-34` (a text `✓` takes the surrounding font and reads as a font
falling back at badge size), and it was reported from the field.

## Prompt

```text
Settle DiveDay's rule for success/warning text on a tinted fill, then de-duplicate the tone glyphs.

Read first: src/components/ui/badge.tsx (the toneClass comment at ~:10 and toneGlyph at ~:36),
src/app/shop/[shopSlug]/_components/today/KindChip.tsx (~:16), src/components/ui/form.tsx (~:283),
src/components/ShopPageHeader.tsx (~:139 and ~:236), src/app/globals.css, and
docs/product/follow-ups/FU-20260815-tone-glyph-and-contrast-rule.md.

The constraint that makes this non-obvious: badge.tsx documents `text-success` on `bg-success/10` as
measuring just UNDER AA and therefore uses `-strong`; KindChip.tsx documents warning on `bg-surface`
as measuring 5.02:1 and PASSING. Both are in the tree, and about eight surfaces render the plain
token on a tint — including FormStatus, the component that tells a staffer a save was refused. The
two claims are about different backgrounds, which is why this needs one measured answer rather than
another reading of the comments.

Do: (1) actually compute the contrast ratios from the token values in globals.css, for both
tinted-fill and bg-surface, in light AND dark, and record the numbers in
docs/design/forms-and-controls.md. (2) Sweep the sites listed in the follow-up to whichever token
the numbers support, and fix whichever existing comment is wrong. (3) Export the ✅⚠️❌ map once from
badge.tsx (or a new src/components/ui/tone.ts) and delete the duplicate declarations in form.tsx and
ShopPageHeader.tsx.

Do NOT change the glyphs from emoji to text marks — that was a deliberate, field-reported decision
argued in badge.tsx:22-34.

Done when: the numbers are written down, no file contradicts another about them, the glyph set is
declared once, and `pnpm check` is green. Expect visual diffs on any surface whose token changed;
explain each in the PR description.

Delete docs/product/follow-ups/FU-20260815-tone-glyph-and-contrast-rule.md as part of the change.
```
