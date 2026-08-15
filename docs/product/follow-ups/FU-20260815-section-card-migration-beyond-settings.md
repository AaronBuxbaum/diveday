# FU-20260815-section-card-migration-beyond-settings — Move the other 140 files onto `SectionCard`, route by route

- **Status:** Open
- **Raised:** 2026-08-15 — the change that added `src/components/ui/card.tsx` and migrated
  `src/app/shop/[shopSlug]/settings/**` to it (branch `worktree-bridge-cse_017Xz6AACPW3YpfdzpyRX8E1`,
  closing FU-20260815-section-card-vocabulary)
- **Kind:** cleanup
- **Effort:** L
- **Touches:** `src/components/ui/card.tsx`, `src/app/shop/[shopSlug]/trips/`,
  `src/app/shop/[shopSlug]/divers/`, `src/app/shop/[shopSlug]/_components/`,
  `src/app/shop/[shopSlug]/dive-sites/`, `src/app/shop/[shopSlug]/orders/`, `src/components/`,
  `src/app/s/[shopSlug]/`, `docs/design/forms-and-controls.md`

## What I noticed

`SectionCard` (`src/components/ui/card.tsx`) now exists and is the canonical bordered panel:
`rounded-2xl border border-border bg-surface shadow-sm`, the spelling `ShopStat` and the `<Table>`
shell already shared, with the `<h2 className="text-lg font-semibold">` section heading folded in
and no outer margin of its own. Only `src/app/shop/[shopSlug]/settings/**` was converted, because
converting 150-odd files at once would have made the visual-regression triage unreadable — and the
whole point of reviewing those diffs is being able to say why each one moved.

So **140 files still type the panel by hand**, and they still disagree with each other. Counting
the `rounded-* border border-border bg-surface` string outside settings today: `rounded-2xl` ×93,
`rounded-lg` ×63, `rounded-xl` ×52, `rounded-3xl` ×4. `shadow-sm` is on a minority of them, so two
identically-shaped cards still sit at two elevations on one page.

Where they are, biggest clusters first:

- `src/app/shop/[shopSlug]/trips/` — 20 files (the roster, manifest, prep and log surfaces)
- `src/app/shop/[shopSlug]/divers/` — 13 files
- `src/components/` — 29 files (shared surfaces, so these move *more* than one route each)
- `src/app/shop/[shopSlug]/_components/` — 8 (the Today queue and blocker groups)
- `src/app/shop/[shopSlug]/dive-sites/` — 7, `orders/` — 6, `check-in/` — 5, `waivers/` — 4,
  `schedule/` — 4, `courses/` — 4, `bookings/` — 3
- `src/app/s/[shopSlug]/**` — 10 (the diver-facing schedule, trip and course pages)
- the bearer-token pages — `waivers/` ×3, `recap/` ×2, `ready/` ×2 — and the marketing pages
  (`/`, `/product`, `/about`, `/claim`, `/switching`) ×8

A person's version of this: `staffing/page.tsx` still disagrees with itself three times in one file
(`rounded-2xl p-5`, `rounded-xl p-4`, `rounded-2xl px-5 py-4`), and the signature list on
`waivers/signatures` is still a `rounded-lg` `<ul>` with no shadow beside a `<Table>` that is
`rounded-2xl` with one.

Section rhythm has the same problem one level up, and the same fix: `<section className="mt-N">`
still takes nine different values outside settings (`mt-10` ×23, `mt-6` ×17, `mt-8` ×14, `mt-12`
×9, then one or two each of `mt-7`, `mt-3`, `mt-9`, `mt-5`, `mt-4`).

## Why it isn't already done

Scope, deliberately. The change that raised this was asked to build the component and prove it on
one coherent cluster — settings was the densest and most obviously self-inconsistent, and it is a
visual-diff story a reviewer can hold in their head. Landing 150 files at once would move nearly
every staff screenshot in the same build, and a reviewer who cannot explain each diff waves all of
them through, which is the failure mode the visual suite exists to prevent.

The remaining work is mechanical per route but genuinely needs a human eye per route, for three
reasons the settings pass hit repeatedly:

1. A hand-typed panel is sometimes a **shell** (a divided list, a `<details>`, a table wrapper)
   rather than a padded card — `padding="none"`, not `padding="md"`.
2. Some panels are **nested** inside another card and must drop their shadow (`elevated={false}`)
   or step their heading down (`titleAs="h3"`), or the page reads flat.
3. Each route's `loading.tsx` has to move in the same commit, via `sectionCardClass()` — a
   skeleton that keeps the old radius or the old `mt-*` is a layout jump on every navigation into
   the route, which is exactly what those files exist to prevent.

## Proposed change

One PR per cluster, in roughly this order (widest blast radius first, so later routes inherit):

1. `src/components/**` — the shared surfaces, since each one moves several routes at once.
2. `src/app/shop/[shopSlug]/trips/**` and `_components/**` — the densest staff surfaces.
3. `divers/`, `orders/`, `dive-sites/`, `check-in/`, `waivers/`, `schedule/`, `courses/`,
   `bookings/`, then the small ones.
4. `src/app/s/[shopSlug]/**` and the bearer-token pages.
5. The marketing pages last — they are the most bespoke and the least like a staff card, so they
   may earn a written exemption rather than a conversion.

In each: replace the hand-typed `rounded-* border border-border bg-surface p-*` with `SectionCard`,
fold the section heading into `title`, drop the call site's leading `mt-4`/`mt-3`/`mt-5` on the
body (the card owns that gap), and replace per-section `mt-*` with one `space-y-10` on the page's
section wrapper. Update the route's `loading.tsx` through `sectionCardClass()` in the same commit.

Do **not** add a `radius` prop, a `padding` value per call site's current value, or a second
"softer" card for the diver-facing pages. A prop that lets every call site keep what it has today
preserves the drift behind an abstraction — that is stated in `card.tsx`'s own doc comment and in
`docs/design/forms-and-controls.md`, and it is the reason this cleanup is worth doing at all.

Worth considering while doing it: a repo check (`scripts/`) that refuses a new
`rounded-* border border-border bg-surface` literal under `src/app`/`src/components`, ratcheted
like `check:tokens` so the remaining files are a baseline that can only shrink. Without one,
the next new page adds a 141st spelling while these PRs are in flight.

## Prompt

```text
Continue migrating DiveDay onto the canonical section card, one cluster at a time.

Read first: src/components/ui/card.tsx (the component and its doc comment), the "Cards:
SectionCard" section of docs/design/forms-and-controls.md, and one already-migrated route as the
worked example — src/app/shop/[shopSlug]/settings/whatsapp/page.tsx plus its loading.tsx, and
src/app/shop/[shopSlug]/settings/export/_components/BackupsSection.tsx for the nested case.

Background: the bordered panel a page is made of used to be retyped 209 times across 153 files at
four radii and six paddings. `SectionCard` is now the one spelling (rounded-2xl border
border-border bg-surface shadow-sm, the ShopStat/Table shell spelling) and settings/** is
converted. About 140 files still carry the hand-typed version.

Pick ONE cluster and stop there — the list, biggest first: src/components/** (29 files),
src/app/shop/[shopSlug]/trips/** (20), divers/ (13), _components/ (8), dive-sites/ (7), orders/
(6), check-in/ (5), waivers/ (4), schedule/ (4), courses/ (4), bookings/ (3), src/app/s/** (10),
the bearer-token pages (waivers/recap/ready, 7), the marketing pages (8). Say in the PR
description which cluster you took and what is left.

Do, per file: replace the hand-typed panel with <SectionCard>; fold the section's <h2> into
`title` and its lead paragraph into `description`; drop the body's leading mt-* (the card owns that
gap); replace per-section mt-* with one `space-y-10` on the page's section wrapper. Use
padding="none" for a shell (a divided list, a <details>, a table wrapper), elevated={false} for a
card nested inside another card, and titleAs="h3" for a card under a group that already owns the
h2. Update that route's loading.tsx in the SAME commit using sectionCardClass(), or the skeleton
becomes a layout jump.

Do NOT add a `radius` prop, a per-call-site padding, or a second softer card for diver-facing
pages — that preserves the drift behind an abstraction, which is the whole thing this is fixing.

Done when: the cluster renders through SectionCard; `pnpm check` is green; and the PR description
explains, per visual diff, why the pixels moved (radius / padding / elevation / heading-size
normalisation). Expect most screenshots in the cluster to change — review every one, never wave
them through. Delete
docs/product/follow-ups/FU-20260815-section-card-migration-beyond-settings.md only when the LAST
cluster lands; until then, update its counts and its cluster list in the same PR.
```
