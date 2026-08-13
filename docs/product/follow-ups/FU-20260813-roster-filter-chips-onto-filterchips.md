# FU-20260813-roster-filter-chips-onto-filterchips — Converge the trip roster's `?rf=` chips onto the FilterChips primitive

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-staff-list-ergonomics` (one chip vocabulary for staff list filters)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`, `src/components/ui/FilterChips.tsx`

## What I noticed

That branch introduced `src/components/ui/FilterChips.tsx` as the one vocabulary for a
view-narrowing chip row and converted two of the three hand-rolled copies onto it: the divers
roster (`divers/_components/DiverList.tsx`, which had its own `chipClass`) and the reviews page
(which flipped `buttonClass` variants). The third copy is still hand-rolled: the trip roster's
`?rf=` filter chips in `RosterSection.tsx` (`filterChipClass`, ~line 237). Its pill styling is
byte-for-byte the class string FilterChips now owns, so today they render identically — but the
next tweak to one will silently miss the other, which is exactly how the three idioms diverged in
the first place.

## Why it isn't already done

`RosterSection.tsx` sits in the trip-page area another parallel workstream owned during the
redesign sweep, so touching it risked a needless merge conflict. The conversion is mechanical and
lost nothing by waiting.

## Proposed change

In `RosterSection.tsx`, delete `filterChipClass` and replace the `<nav>` of three `<Link>`s with
one `<FilterChips>` call: `label={t("trips.roster.filterAriaLabel")}`, and per chip
`key`/`href` (from the existing `filterChipHref`)/`active={rosterFilter === filter}`/`label` (the
existing count-carrying strings). Note FilterChips hardcodes `scroll={false}`, which the roster's
links already pass, and adds `aria-current="true"` on the active chip — a small a11y gain, and
worth a quick check that no e2e spec asserts the *absence* of `aria-current` there. Not proposing
any visual change: the class strings are already identical.

## Prompt

```text
Read src/components/ui/FilterChips.tsx (and its colocated test) and
src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx. RosterSection still hand-rolls
its `?rf=` roster filter chips (`filterChipClass`, `filterChipHref`) even though FilterChips is
now the one vocabulary for staff-list filter rows (the divers roster and the reviews page already
use it). Replace the hand-rolled nav with a single <FilterChips> call, keeping the exact same
hrefs, the count-carrying labels from the trips.roster.filter* keys, and the existing
aria-label. Do not change the pill styling — it is already identical. Done means: no
filterChipClass left in RosterSection, chips render with aria-current on the active one, and
`pnpm check` plus `pnpm e2e e2e/trip-roster.spec.ts --reporter=line` (or whichever spec covers
the guests tab — grep e2e/ for "?rf=" or "Needs waiver") are green. Delete
docs/product/follow-ups/FU-20260813-roster-filter-chips-onto-filterchips.md as part of the change.
```
