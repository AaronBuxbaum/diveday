# FU-20260810-board-sticky-day-headers — Make the staff board's day headers sticky like the storefront's

- **Status:** Open
- **Raised:** 2026-08-10 — the calendar-grammar design pass (branch claude/app-design-overhaul-q0u9qy)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`, `src/app/s/[shopSlug]/page.tsx`

## What I noticed

The board now renders the public schedule's calendar-block day headers (big numeral, weekday/month
caps, hairline), but only the public schedule's version is `sticky top-0` — mid-scroll on the
storefront the reader always knows which day the rows under their thumb belong to, while on the
staff board (a two-week window, often 15+ rows on a phone) the day header scrolls away and a
staffer deep in Thursday has to scroll back up to confirm it is Thursday.

## Why it isn't already done

The board's rows carry disclosed UI the public page has none of: each row's "⋯" menu opens an
absolutely-positioned panel at `z-20`, and the add/move/copy/remove forms animate open between
rows. A sticky header needs its own background and z-index above row content but below open menus,
and getting that stacking wrong shows up as a menu sliding *under* the pinned header — a visual
bug worth its own focused screenshot round, not a rider on an already-large restyle.

## Proposed change

Mirror the public page's pattern on the board's day header row: `sticky top-0 z-10 bg-background`
(the public one uses `z-20`; the board's row menus already use `z-20`, so the header must sit
below them — either header `z-10`, or bump the menus to `z-30`). Keep the day's "+ Add" button
inside the sticky row so the affordance travels with the day. Check an open row menu near the top
of the viewport renders above the pinned header, and that the demo banner/nav (which are not
sticky) don't fight it. Not proposing sticky urgency-band headers on Today — those bands are short
and the fold already handles the long tail.

## Prompt

```text
Read src/app/s/[shopSlug]/page.tsx (search "sticky") and
src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx (the day header block and
the data-row-menu "⋯" menus). Make the board's day headers sticky exactly like the public
schedule's, with a background so rows don't ghost through, and a z-index below the row menus'
popovers (bump the menus if needed). Constraint: an open "⋯" menu near the viewport top must
render above the pinned header, and add/move/copy panels must not be overlapped while open.
Done when node scripts/screenshot.mjs /shop/blue-mantis/schedule/board plus a manual mid-scroll
check (phone width, menu open) shows correct stacking in light and dark, and pnpm check is green.
Delete docs/product/follow-ups/FU-20260810-board-sticky-day-headers.md as part of the change.
```
