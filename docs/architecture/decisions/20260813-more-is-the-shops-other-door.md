# 20260813-more-is-the-shops-other-door — The nav's sixth slot is "More", carrying every destination the five tabs don't

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The destination registry (`src/lib/staff-destinations.ts`) holds nineteen places, and the staff
nav rendered five of them: Today, Check-in, Divers, Board, Orders. Both `daily` and `setup` nav
groups were empty, so the header's fully built "More" menu rendered nothing, and fourteen
destinations were reachable only through ⌘K, a contextual door, or a card on a page you had to
already be on — Close-out's one door appeared on Today only once the last boat was in, Reviews
had no door at all outside the palette, and Settings hid behind the shop-name identity menu. ⌘K
is the whole keyboard story (ADR 20260811-command-palette-is-the-only-keyboard-route), but on a
phone there is no keyboard: the dock showed five tabs and the header showed identity plus a
search icon, so most of the shop was invisible to a thumb. The dock has a hard ceiling — five
tabs at ~65px each at 390px, six absolute — so the answer could never be more tabs.

## Decision

- **`daily` and `setup` are populated, deliberately.** `daily` ("Run the shop") is the
  operational cadence a shop returns to on its own rhythm: Close-out, Staffing, Courses, Dive
  sites, Waivers, Reviews, Reports. `setup` ("Set up") is what a shop configures rather than
  works: Team, Promo codes, the staffer's own calendar feed, and Settings — always last. What
  stays out of the nav (`navGroup: null`) is only what is not a *place*: an action
  (`addBooking`), a way into a page (`walkIn`), a view of one (`blockers`).
- **The phone dock's sixth slot is "More"** — a button opening a bottom sheet that rises from
  the dock itself, rendering the identical `MoreGroups`/`MoreLink` rows the desktop header's
  "More" menu holds, so the whole shop is two thumb-taps from anywhere. The sixth slot is spent
  permanently; promoting a destination to `primary` means demoting another, never a seventh tab.
- **The identity menu returns to identity.** It holds what is about *this reader, this device,
  this session* — language and sign out. Settings' door moves to the "Set up" group; one
  destination in two menus is the duplicate control design principle 8 forbids.
- **One "you are here" resolver.** `currentStaffNavDestinationId` answers "which row is
  current?" for every consumer, most-specific-claim-wins, so `/settings/team` lights Team
  without also lighting Settings. The borrowed `alsoMatch` claims (Today over `/close-out`,
  Orders over `/reports`, Settings over `/promos` `/dive-sites` `/waivers`, Board over
  `/staffing`) are dropped — a page with its own row lights its own row; `alsoMatch` remains
  only for true detail views (the board over `/trips`).
- **Gates are unchanged**: a gated destination is absent from both More surfaces, never
  disabled (ADR 20260724-role-gated-surfaces-hide-not-explain), and ungated rows in each group
  (Close-out, Staffing; the calendar feed) mean no role ever sees an empty menu.

## Alternatives considered

- **Keep palette-only reach and add contextual doors per surface.** Rejected: fourteen
  destinations reachable only by ⌘K was a desktop-keyboard answer to a phone-thumb question,
  and per-surface doors are exactly the drift the registry exists to end.
- **The identity menu carries the groups instead of a dock slot.** Rejected: the door lands at
  the top-left — the worst one-handed reach — overloads the shop's own name with "everywhere in
  the shop", and forks the desktop More into a second grammar.
- **A swipe-up or long-press on the dock.** Rejected: an undiscoverable precision gesture fails
  the dock test (wet fingers, glare) by construction.
- **A sixth destination tab (e.g. Settings back).** Rejected: the ceiling is real, and any
  single pick leaves thirteen others buried — the slot buys more spent on a door than a place.

## Consequences

- Every registered place has a visible, touch-reachable door at every width; ⌘K stays the
  keyboard accelerator rather than the only route.
- The dock's five destination tabs shrink to six slots' width (~65px each holds at 390px); the
  sheet's rows are 44px targets.
- The header's "More" machinery (details/summary, outside-tap and Escape dismissal) is live
  again instead of dead code; the sheet reuses its row components, so the two doors cannot
  present a destination differently.
- Adding a destination now means choosing its group in the registry and nothing else — every
  consumer updates by derivation.
- Escape hatch: if the two-group split stops matching how shops think (e.g. a "daily" group
  grown past ~8 rows), regroup in the registry — consumers render whatever the groups hold; the
  costly part was the doors, which stay.
