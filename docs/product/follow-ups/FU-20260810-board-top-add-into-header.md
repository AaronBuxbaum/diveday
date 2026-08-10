# FU-20260810-board-top-add-into-header — Fold the board's top "+ Add a departure" into the page-header actions

- **Status:** Open
- **Raised:** 2026-08-10 — design-critic review during the calendar-grammar design pass (branch claude/app-design-overhaul-q0u9qy)
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/schedule/board/page.tsx`, `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`, `e2e/schedule-builder.spec.ts`, `e2e/schedule-trip.spec.ts`, `e2e/blowout.spec.ts`, `e2e/role-permissions.spec.ts`, `e2e/visual.spec.ts`

## What I noticed

The board's top "+ Add a departure" secondary button sits alone, right-aligned, on its own band
between the page header and the unpriced-departures banner — a stratum of dead space whose only
content duplicates the "+ Add" every day header already carries. A design review flagged it under
principles 8/9: the control is legitimate (it is the `add:top` landing target for the former
`/trips/new` doors), but it does not need its own row when the page header directly above already
holds an action cluster ("View public page", "Add a booking").

## Why it isn't already done

The button is a client-side toggle inside `ScheduleBuilder` (it flips the `add:top` panel state
and participates in the component's focus-return bookkeeping), while the page-header action
cluster is server-rendered in `page.tsx` — moving it across that boundary is not a class-name
change. The clean route is to make the header control a plain link to `?add=quick`, which the
existing `openAdd` prop already turns into an open panel — but that changes the control's role
from button to link, and eleven unit tests plus four e2e specs (and a visual capture) click
`getByRole("button", { name: "Add a departure" })`. Rewiring role queries, the role-permissions
assertion that crew see no such control, and the panel's cancel-focus behaviour (there is no
in-component toggle to return focus to when the panel was opened by a link) deserved its own
change, not a rider at the end of a large restyle.

## Proposed change

In `page.tsx`, add a secondary "Add a departure" `Link` to `?add=quick` in the `PageHeader`
actions (gated on the same `canConfigure` permission; "Add a booking" stays the page's one
primary). In `ScheduleBuilder`, delete the top button band; keep the `add:top` panel rendering,
opened via `openAdd`, and make its Cancel close the panel and clear the `?add` param (e.g.
`router.replace` to the bare board path) so a re-tap of the header link reopens it. Update the
tests and specs to `getByRole("link", { name: "Add a departure" })` and re-assert crew see
neither the link nor any "+ Add". Not proposing to drop the control entirely: the former
`/trips/new` doors 308 into `?add=`, and a board with zero days would otherwise have no add
affordance at all.

## Prompt

```text
Read src/app/shop/[shopSlug]/schedule/board/page.tsx (the PageHeader actions and the openAdd
computation), src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx (the
"add:top" band, toggleRefs, and closePanel), and docs/design/principles.md #8. Move the top
"Add a departure" control out of ScheduleBuilder and into the page header's action cluster as a
secondary-weight Link to ?add=quick, gated on canConfigure; delete the standalone band; keep the
add:top panel opened via openAdd and give its Cancel a way to clear ?add so the link works twice
in a row. Constraint: "Add a booking" must remain the page's only primary, and a crew login must
see neither the header link nor the per-day "+ Add" (e2e/role-permissions.spec.ts asserts this).
Update the role queries in ScheduleBuilder.test.tsx and in e2e/schedule-builder.spec.ts,
schedule-trip.spec.ts, blowout.spec.ts, role-permissions.spec.ts, and the visual spec's board
capture flow. Done when pnpm check is green and pnpm e2e:run for those specs passes. Delete
docs/product/follow-ups/FU-20260810-board-top-add-into-header.md as part of the change.
```
