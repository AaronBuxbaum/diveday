# FU-20260815-section-card-migration-beyond-settings — Finish the SectionCard migration across the staff routes no cluster reached

- **Status:** Open
- **Raised:** 2026-08-15 — creating `SectionCard` and migrating `settings/**`.
  **Rewritten the same day** after four more clusters landed: the original entry counted 140 files
  and that number is now both wrong and misleading. See "What changed" below.
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/_components/today/`, `src/app/shop/[shopSlug]/check-in/`,
  `src/app/shop/[shopSlug]/waivers/`, `src/app/shop/[shopSlug]/schedule/`,
  `src/app/shop/[shopSlug]/courses/`, `src/components/ui/card.tsx`

## What I noticed

`SectionCard` (`src/components/ui/card.tsx`) now backs **88 files**: `settings/**`, `trips/**`,
`divers/**`, `orders/**`, the shared `src/components/**`, the diver-facing `src/app/s/[shopSlug]/**`,
the bearer-token pages, `dive-sites/**`, and the marketing routes.

The staff areas no cluster was assigned, and which still hand-type the panel:

| Area | Files |
| --- | --- |
| `_components/` and `_components/today/` (the shop home: Today queue, urgency bands, departure board, blocker groups, seat-diver panel) | 8 |
| `check-in/` incl. the walk-in counter | 5 |
| `waivers/` and `waivers/signatures/` | 4 |
| `schedule/` and the board | 4 |
| `courses/` | 4 |
| `bookings/new/` | 3 |
| `staffing/`, `reports/`, `promos/`, `close-out/` | 2 each |
| `reviews/`, `requests/` | 1 each |
| `claim/[token]/` | 2 |

## What changed, and the number not to trust

`grep -rln "border border-border bg-surface" src/app src/components` returns **85 files**, and
reading that as a to-do list is the mistake this rewrite exists to prevent. Every cluster's pass
sorted its remainder and left the reason at the site. Those are **not** section cards and must not
be converted:

- **sunken insets** (`bg-surface-sunken`) — carved into a card rather than raised on the page;
  `ShopStat`'s `inset` variant is the precedent
- **overlays** — dropdowns, modals, toasts, the phone bottom sheet, all `shadow-lg`/`shadow-2xl`
- **tone-carrying panels** — a paid receipt, a warning callout; the shared card models no tone
- **`<fieldset>`s** whose `<legend>` is the accessible name of a control group. The medical
  questionnaire is the one that matters: converting it would cost that name, and
  `SectionCard`'s `as` set deliberately has no `fieldset`
- **`bg-background` cards on marketing pages**, which are that colour precisely because the band
  behind them is `bg-surface`

`src/components/ui/**` (8 of the 85) is the vocabulary itself — `card.tsx` defines the spelling and
`table.tsx` owns its own shell. Neither is a call site.

So the real remainder is "the staff areas in the table above", not 85.

## Why it isn't already done

Four agents ran four clusters in parallel and these areas were not assigned to any of them. Nothing
about them is harder than what landed; they were simply outside the four scopes, and doing them in
the same change would have made one visual-diff review cover most of the staff app at once — the
thing that makes these diffs reviewable is being able to say why each screen moved.

One open design question sits underneath the Today cluster specifically, and is the reason to take
it first and deliberately: the urgency bands and the departure board are **tone-carrying** surfaces,
and the shared card models no tone. Either they keep hand-typed geometry (and the drift returns
through the busiest screen in the product), or `SectionCard` grows a tone vocabulary — which is a
fourth widening prop after the three `card.tsx` already refuses, and deserves the same scrutiny.

## Proposed change

One PR per row of the table, in this order — busiest and most-photographed first, so the visual
review is smallest while the pattern is still fresh:

1. `_components/today/` + `_components/` — **decide the tone question first** and record it in
   `card.tsx`'s "What is *not* a section card" section either way.
2. `check-in/`, `bookings/new/` — the counter flows.
3. `waivers/`, `schedule/`, `courses/`.
4. The four singles: `staffing/`, `reports/`, `promos/`, `close-out/`, `reviews/`, `requests/`,
   `claim/[token]/`.

Per PR: `SectionCard` owns its heading and the gap beneath it, so a migrated call site drops its own
`mt-*`; pages space sections with `space-y-10`; **a route's `loading.tsx` moves with its page**
(`sectionCardClass()`), or the skeleton becomes a layout jump on every navigation into the segment.
Leave a written reason at any panel you decline to convert, the way the landed clusters did.

**Not proposed:** a `radius`, `padding`-per-site, or fill prop. Three were asked for during the
first five clusters and all three were refused; the reasoning is in `card.tsx`.

## Prompt

```text
Continue DiveDay's SectionCard migration. `SectionCard` (src/components/ui/card.tsx) now backs 88
files; the staff areas below still hand-type the panel because no cluster was assigned them.

Read first:
  - docs/product/follow-ups/FU-20260815-section-card-migration-beyond-settings.md (this file — its
    table names the areas, and its "What changed" section explains why the raw grep count of 85 is
    NOT the to-do list)
  - src/components/ui/card.tsx, especially "What is *not* a section card"
  - docs/design/forms-and-controls.md, the Cards section
  - src/app/shop/[shopSlug]/settings/** for the worked example

Take ONE area per PR, in the order this file gives. Start with
src/app/shop/[shopSlug]/_components/today/ and _components/ — and before writing any code, settle
the question that area raises: the urgency bands and departure board CARRY TONE, and SectionCard
models none. Either they keep hand-typed geometry, or SectionCard grows a tone vocabulary. That
would be the fourth widening prop the component has been asked for, and the other three were
refused; whichever you decide, write it into card.tsx's "What is *not* a section card" section so
the next person does not re-open it.

The canonical spelling is `rounded-2xl border border-border bg-surface shadow-sm`, padding md =
`p-4 sm:p-5`, lg = `p-5 sm:p-6`. Do NOT add a radius, per-site padding, or fill prop.

Traps the landed clusters hit, in order of how much they cost:
  - a route's loading.tsx must move with its page (sectionCardClass()), or the skeleton is a layout
    jump on every client navigation into that segment
  - SectionCard owns its heading and the gap under it — drop the call site's own mt-*
  - a card nested directly inside another card at the same radius and fill reads as a rendering
    bug; if you have arrived there, the inner thing is an inset, an overlay or a tone panel, and
    stays as it is. Leave the reason at the site.
  - do not convert a <fieldset> whose <legend> names a control group — SectionCard's `as` set has
    no fieldset, and converting costs the accessible name

Done when: the area renders through SectionCard, `pnpm check` is green, every panel you declined
carries a written reason, and the PR description explains per visual diff why the pixels moved
(radius/padding/elevation/heading normalisation). Expect most of that area's screenshots to change
and review every one.

Update the "Where this has landed so far" paragraph in docs/design/forms-and-controls.md, and edit
this follow-up's table down to what remains. Delete
docs/product/follow-ups/FU-20260815-section-card-migration-beyond-settings.md only when the table
is empty.
```
