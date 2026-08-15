# FU-20260815-section-card-vocabulary — Give the section panel one shape, the way the badge and the button already have one

- **Status:** Open
- **Raised:** 2026-08-15 — the app-wide consistency sweep on `worktree-bridge-cse_015vZRaiUc7FVWBrtgdhSeER`
- **Kind:** cleanup
- **Effort:** L
- **Touches:** `src/components/ui/`, `src/app/shop/[shopSlug]/settings/whatsapp/page.tsx`, `src/app/shop/[shopSlug]/settings/import/page.tsx`, `src/app/shop/[shopSlug]/staffing/page.tsx`, `docs/design/forms-and-controls.md`

## What I noticed

`src/components/ui/` owns the badge, the button, the form field, the table, the filter chips and
the disclosure caret. It does not own the **card** — the `rounded-* border border-border bg-surface
p-*` panel that a staff page is mostly made of. There is no `Card`, `Panel`, `Section` or `Surface`
component, and `docs/design/` never names a canonical one.

So every page retypes it. That spelling appears **209 times across 153 files**, at four radii
(`rounded-2xl` ×99, `rounded-lg` ×72, `rounded-xl` ×36, `rounded-3xl` ×2) and six paddings (`p-6`
×34, `p-4` ×30, `p-5` ×26, `p-3` ×4, `p-2` ×4, `p-7` ×2). `shadow-sm` is on only 26 of the 153
files, so identically-shaped cards sit at two different elevations on one page.

What a person sees:

- `settings/whatsapp/page.tsx:139` renders its panel `rounded-lg … p-6`; `settings/import/page.tsx:321`
  renders the same kind of panel `rounded-2xl … p-6`. They are sibling routes under one hub, one tap
  apart, at two different corner radii.
- `staffing/page.tsx` disagrees with *itself* three times in one file: `:138` is `rounded-2xl p-5`,
  `:228` is `rounded-xl p-4`, `:169` is `rounded-2xl px-5 py-4`.
- A list on `divers` is a `<Table>` (`rounded-2xl` + `shadow-sm`, fixed by `ui/table.tsx:86`) while
  the list on `waivers/signatures:240` is a `<ul>` at `rounded-lg` with no shadow — the same object
  at two radii.

Section rhythm has the same problem one level up: `<section className="mt-N">` takes nine different
values (`mt-10` ×23, `mt-6` ×17, `mt-8` ×14, `mt-12` ×9, then `mt-7` ×2, `mt-3` ×2, and one each of
`mt-9`, `mt-5`, `mt-4`).

## Why it isn't already done

Out of the scope I was given. The sweep that raised this fixed the primitives that already existed
and were being bypassed (`Badge`, `EmptyState`, `buttonClass`, `Field`, the roll-call tones). This
one is different in kind: the primitive **does not exist yet**, so it is not a migration but a new
piece of design vocabulary, and picking its canonical radius/padding/elevation is a design call
rather than a mechanical one. Doing it in the same change as ~40 other files would also have made
the visual-regression triage unreadable — nearly every staff screenshot would move at once, and the
whole point of reviewing those diffs is being able to say why each one moved.

## Proposed change

Add `src/components/ui/card.tsx`:

```
SectionCard({ as = "section", title?, description?, actions?, padding = "md", elevated = true, className, children })
```

Canonicalise on the spelling `ShopStat` already uses at `src/components/ShopPageHeader.tsx:159` —
`rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5` — with `padding="lg"` →
`p-5 sm:p-6`, so a card and a `<Table>` shell are visibly the same object. Fold in the `<h2
className="text-lg font-semibold">` section heading, which is already the dominant one (27
occurrences, against `text-xl` ×6 and `text-base` ×4).

Migrate **`settings/**` first** and stop there for one PR: it is the densest and most obviously
self-inconsistent cluster (23 panels across 5 routes, split between `rounded-lg` and `rounded-2xl`),
and it is a coherent visual-diff story on its own.

Do **not** try to land all 153 files in one change, and do **not** add a `radius` prop — a prop that
lets every call site keep its current radius preserves the drift while adding an abstraction.

Settle the section rhythm in the same PR by giving `SectionCard` no outer margin and having pages
wrap their sections in `space-y-10`, rather than keeping per-section `mt-*`.

## Prompt

```text
Add a canonical section-card component to DiveDay and migrate the settings routes to it.

Read first: docs/design/forms-and-controls.md, src/components/ui/table.tsx (its shell spelling),
src/components/ShopPageHeader.tsx (the ShopStat card at ~:159), and
docs/product/follow-ups/FU-20260815-section-card-vocabulary.md.

The constraint that makes this non-obvious: the same panel is spelled 209 different-ish ways across
153 files, at four radii and six paddings, and `shadow-sm` is present on only 26 files. Picking one
is a design decision, not a mechanical one — the intended answer is the ShopStat/Table shell
spelling (`rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5`) so that a card, a stat
tile and a table shell read as the same object.

Do: create `src/components/ui/card.tsx` exporting `SectionCard({ as, title, description, actions,
padding, elevated, className, children })`. Do NOT add a `radius` prop — that would preserve the
drift behind an abstraction. Then migrate ONLY `src/app/shop/[shopSlug]/settings/**` (about 23
panels across 5 routes). Leave the other ~130 files for later PRs and say so in the PR description.

Done when: settings panels all render through SectionCard; `pnpm check` is green; and the PR
description explains, per visual diff, why the pixels moved (radius/padding/elevation
normalisation). Expect most settings screenshots to change — review every one, never wave them
through.

Delete docs/product/follow-ups/FU-20260815-section-card-vocabulary.md as part of the change.
```
