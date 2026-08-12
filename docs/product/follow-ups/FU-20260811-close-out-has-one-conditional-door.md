# FU-20260811-close-out-has-one-conditional-door — Decide whether the close-out deserves an unconditional door, or none at all

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/trip-ui-refinements-tssb81`, from the question "how do I get to
  close-out in the current system, and do we even need this system any more?"
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/staff-destinations.ts`, `src/app/shop/[shopSlug]/page.tsx`,
  `src/app/shop/[shopSlug]/close-out/`, `docs/architecture/decisions/20260804-day-closeout.md`

S is the recommended fix — changing when Today's card renders. Retiring the surface instead
would be an M.

## What I noticed

`/shop/[shopSlug]/close-out` has exactly two doors, and one of them is conditional:

1. **Today's evening handoff card** (`src/app/shop/[shopSlug]/page.tsx`, the `lastBoatIsIn(...)`
   branch). It renders only when the day has at least one departure *and every one of them has
   already ended*. So on a day with a night dive still on the schedule, a day where a boat is
   running late, or a day with no departures at all, there is no card — and on those exact days a
   staffer may still want to walk the close-out.
2. **⌘K → "Close-out"** (`inPalette: true` in `src/lib/staff-destinations.ts`). It carries
   `navGroup: null`, so it is in no nav and no tab bar. (It had no `g`-key shortcut either; that
   whole mechanism was removed on 2026-08-11 — ADR 20260811-command-palette-is-the-only-keyboard-route.)

There is no third. A staffer who has never been handed the card by Today has no way to learn the
page exists short of typing its name into the palette, which requires already knowing the word.

The registry's own comment calls the close-out "part of every single working day". A destination
described that way, reachable on some days only, is the mismatch this entry is about.

## Why it isn't already done

Both possible answers are product calls, not engineering ones.

Making it unconditional means spending nav weight the header does not have: AGENTS.md fixes the
staff header at five `primary` tabs with six as the ceiling, and the phone dock has no squeezing
room, so a Close-out tab means demoting Today, Check-in, Divers, Board, or Orders. That is a call
about what a dive shop looks at all day, and it is HD-shaped.

Retiring it is also a real option and also not mine. ADR 20260804-day-closeout argues the close-out
is a *ritual* — a recorded act with an append-only trail (`day_closeouts`), deliberately gating
nothing. Nothing downstream reads it. A reasonable person could conclude that an evening pass which
nothing depends on, reached from a card that appears on some evenings, is not earning its surface;
another could conclude the opposite, that the trail is exactly the point and the door is what is
broken.

One thing did change under it on this branch: the close-out is now where the crew writes the
post-trip recap note (`_components/RecapNoteEditor.tsx`), which the nightly run mails to divers
after a departure ends. That is the first piece of work the page owns rather than mirrors, and it
argues for keeping the surface. It does not settle the door.

## Proposed change

Pick one:

- **Keep it, fix the door.** Make Today's card render whenever the shop's day has any *ended*
  departure — not only when every departure has ended — so an evening with a night dive still on
  the board still offers the handoff. Cheapest honest fix; leaves the header alone. This is my
  recommendation.
- **Keep it, promote it.** Give `closeOut` a nav or dock slot of its own, and
  decide separately whether it earns a tab (which means demoting one).
- **Retire it.** Fold the leftovers carry/dismiss into Today and delete the route, the
  `day_closeouts` trail, and ADR 20260804 (superseded). Do **not** do this without also deciding
  where the recap note goes — the trip's own page is the only other post-trip surface, and putting
  it back there alone is what this branch just moved away from.

Not proposed: leaving the card conditional *and* adding a second conditional door. Two doors that
each appear sometimes is worse than one that always does.

## Prompt

```text
Decide and implement the close-out surface's door, in the DiveDay repo.

Read first, in order:
  - docs/architecture/decisions/20260804-day-closeout.md (why the surface exists and what "ritual, not a gate" means)
  - src/app/shop/[shopSlug]/page.tsx — the `lastBoatIsIn(departures, now)` branch near the bottom
  - src/lib/today.ts — `lastBoatIsIn`
  - src/lib/staff-destinations.ts — the `closeOut` entry and the five-primary-tab ceiling comment
  - src/app/shop/[shopSlug]/close-out/page.tsx and its _components/RecapNoteEditor.tsx

The constraint that makes this non-obvious: the staff header holds five primary tabs with six as a
hard ceiling (AGENTS.md), so "just add a tab" costs another destination its place. And the
close-out now hosts the post-trip recap note, so retiring the page means relocating that editor,
not just deleting a route.

Unless the human who triages this says otherwise, implement the recommended option: change Today's
handoff card to render when *any* of the shop's departures for the day has ended, rather than only
when all of them have. That means a new predicate beside `lastBoatIsIn` in src/lib/today.ts (keep
`lastBoatIsIn` if anything else still reads it; delete it if not), its own unit tests in
src/lib/today.test.ts covering: no departures, one ended and one still out, all ended, none ended.
Update the card's comment in src/app/shop/[shopSlug]/page.tsx to say what it now keys on, and
amend docs/architecture/decisions/20260804-day-closeout.md with a dated note recording the change.

Done when: the new predicate has tests for all four cases, `pnpm check` is green, and
`pnpm e2e e2e/closeout.spec.ts --reporter=line` passes.
Delete docs/product/follow-ups/FU-20260811-close-out-has-one-conditional-door.md as part of the change.
```
