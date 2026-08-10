# FU-20260810-quieter-kind-chips — Quiet the Today queue's kind chips now the buttons are gone

- **Status:** Open
- **Raised:** 2026-08-10 — the calendar-grammar design pass (branch claude/app-design-overhaul-q0u9qy)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/_components/today/KindChip.tsx`

## What I noticed

The design pass dissolved the Today queue's bordered "Open …" buttons into whole-row links, so the
loudest remaining element on every queue row is now its kind chip — a bordered, bold, uppercase,
letter-spaced pill (`WAIVER`, `PREP`, `FILL SEATS`) rendered by `KindChip`. On a queue of a dozen
rows the neutral-tone chips repeat at the same visual weight as the danger ones, which is the
"badge on every row means nothing on any" failure design/principles.md #9 names: a staffer
scanning for the red `MISSING DIVER` chip has to read past ten grey pills shaped exactly like it.

## Why it isn't already done

Outside the scope of the pass that raised it, and the chip is deliberately one shared component:
the close-out page labels the very same rows with the very same chip, so a restyle has to be
judged on both surfaces (including the close-out's `count` variant, "WAIVER · 3") and re-measured
for contrast, which deserved its own screenshot round rather than a drive-by at the end of a large
change.

## Proposed change

In `KindChip.tsx`, keep the danger/warning chips exactly as they are (they are the signal) and
demote only the `neutral` tone from a bordered pill to plain small-caps muted text — same words,
same placement, no border, no fill. That preserves "state never by color alone" (the words remain)
while spending chip-weight only on the exceptional states. Not proposing per-surface variants: the
whole point of the shared component is that Today and the close-out label rows identically. Verify
both surfaces in light and dark, and re-check the close-out's counted chips still read as one unit.

## Prompt

```text
Read docs/design/principles.md #9, src/app/shop/[shopSlug]/_components/today/KindChip.tsx, and its
two consumers (TodayQueue.tsx and src/app/shop/[shopSlug]/close-out/page.tsx). Restyle only the
neutral tone of KindChip from a bordered pill to quiet small-caps muted text, leaving the danger
and warning tones as bordered chips; the count variant ("WAIVER · 3") must still read as one unit.
Constraint: the component is shared so both surfaces change together, and tone text must keep AA
contrast on bg-surface and bg-surface-sunken in light and dark (measure, don't eyeball). Done when
node scripts/screenshot.mjs /shop/blue-mantis /shop/blue-mantis/close-out shows the queue's danger
chips as the only pill-weight marks, pnpm check is green, and any KindChip tests still pass. Delete
docs/product/follow-ups/FU-20260810-quieter-kind-chips.md as part of the change.
```
