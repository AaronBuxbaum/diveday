# 20261117-trip-page-clock — Show a trip as five phases of one clock, plus Edit trip

- **Status:** Accepted — Aaron chose "The Clock plus Fix list" on 2026-11-16 and asked on 2026-11-17 for it to be built
- **Date:** 2026-11-17
- **Amends:** [20261114-trip-folio-and-individual-deck](20261114-trip-folio-and-individual-deck.md),
  the four workspaces; [20261001-logbook](20261001-logbook.md), decision 3 (a departure's tabs)

## Context

The Trip page's four tabs (Guests, Equipment, The day, Record) each mixed this morning's work with
the trip's settings. Aaron chose The Clock: one trip, shown in the phase of work it is in
([issue #4670](https://github.com/AaronBuxbaum/diveday/issues/4670)).

## Decision

The Trip page (`src/app/shop/[shopSlug]/trips/[id]/`) shows one of five phases at a time, picked by
`?phase=filling|ready|checkin|water|wrapped` or, absent it, the phase the trip is in now:
**Filling**, **Getting ready**, **Check-in**, **On the water** and **Wrapped up**. **Edit trip**
(`?view=edit`) holds everything about the trip that is not about today.

- **The clock is built on `tripPhaseOf`, never beside it** (`src/lib/trip-clock.ts`). Prep splits
  at shop-local midnight of the day before the departure's day (on a multi-day run, the day before
  the next meeting day); `checkin`, `aboard` and `back` map to Check-in, On the water and Wrapped
  up. The crew's tap still beats the clock. A cancelled trip has no phase and opens on Wrapped up.
- **Every phase has three parts**: one sentence saying where the trip stands, the fix list (what is
  in the way, each with the one button that fixes it), then everything else that phase needs.
- **The strip names the kind of work, never where people are.** Sentences about people aboard, in
  the water or back come only from recorded roll-call evidence and the crew's stage taps; with
  neither, the page says what the schedule says.
- **Roll call has a door from Check-in on and on every cancelled trip**; before Check-in it is in
  More. Gear (`/prep`) keeps its route under the same header and strip.
- **Words**: Guests, Roll call, Gear, Plan, everywhere on screen.

Unchanged from 20261114: Roll call records exactly one named person per action, with no group
confirm or count input; a fix list may offer a group message, never a group record of presence.
Domain machinery (actions, authorization, readiness, roll-call evidence, offline sync, undo) stays.

## Alternatives considered

- **Keep the four tabs and tidy them** — each tab still mixes today's work with settings.
- **One long page in time order** — a phone scrolls past five phases to reach the one in progress.
- **Phase from the clock alone** — would claim people are on the water when nobody recorded it.

## Consequences

Every link into the page names a phase or `?view=edit`; `?view=details` and `?view=record` are
gone, not redirected. The phase panels re-host the old sections first and are rebuilt one layer at
a time, so the page works end to end throughout. Leaving costs one route's composition. Revisit if
field use shows staff working across phases more than within one.
