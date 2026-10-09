# 20261009-day-weather-call — One weather call for a whole morning or day

- **Status:** Accepted (2026-10-09)
- **Date:** 2026-10-09

Builds on [20260804-blowout-cascade](20260804-blowout-cascade.md), which made a blow-out one call per
departure, and [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md),
which made that call refund card seats by itself.

## Context

Weather that closes the harbour closes it for every boat that morning. The blow-out was called
one departure at a time: five pages, five confirms. Worse, calling the 08:00 boat first offered
its divers the 10:30 boat as an alternative, and the next tap cancelled that one too. The product
owner approved a day call on 2026-10-09, with three conditions: it reuses the per-trip blow-out so
refunds and messages behave exactly as today, it is open to the same staff as the single-trip call,
and no diver is offered a sister departure the same call cancels.

## Decision

**A day page that ticks departures, and a batch that orders the single-trip blow-out.**

- `/shop/[shopSlug]/schedule/blowout/day/[date]` lists every live departure leaving on that shop day,
  with how many seats are booked on each. Two presets tick every callable departure or only those
  leaving before noon in the shop's zone (`MORNING_ENDS_HOUR`, `src/lib/day-blowout.ts`). The
  staffer can tick any selection. A departure that was already called, is canceled, or has left
  (`hasSailed`, the single-trip call's own test) shows why and links to its cascade record.
  Submitting is the one deliberate step, as on the single-trip confirm.
- `callDayBlowout` (src/db/blowouts.ts) runs **phase one of the single-trip blow-out for every
  ticked departure first**: each in its own transaction, it cancels the trip, records the blow-out
  and snapshots the roster. Only then does it run phase two for each: refunds and messages. The
  candidate departures for every diver's alternatives are read after all of them are canceled, so
  none of them can be offered. The ids are also passed down and excluded by name.
  `callTripBlowout` is the same two phases back to back, so the two paths share every line.
- A departure the call cannot take (left, not this shop's) is reported and the rest go ahead. A
  departure already called resumes, as calling it again alone does.
- `callDayBlowoutAction` is open to all staff, like `callBlowoutAction`, records the same
  `blowout_called` trip activity per departure, and redirects with a `?notice=` counting what was
  called and what was skipped.
- The doors are where the single-trip call is reached: the departure's More list ("Weather blow-out
  for the whole day…") and a link on the single-trip confirm page.

## Alternatives considered

- **Call the single-trip blow-out in a loop.** Each departure's messages would be written while its
  sisters were still scheduled, so the 08:00 divers would be offered the 10:30 boat. This is the
  defect the order exists to prevent.
- **One transaction for the whole day.** A Stripe refund or a send cannot sit inside a database
  transaction, and the per-trip cascade is already resumable. A failure on the third boat now leaves
  the first two called and the third resumable, the same as three single calls.
- **A door on the schedule board's day header.** The header is a 72px sticky rail holding a weekday
  and a numeral. A danger action there sits beside every day of the week, including the ones with no
  weather, and the board is where departures are planned rather than called off.

## Consequences

A staffer calls off a morning in one confirm, every diver gets exactly the message a single call
would have sent, and nobody is offered a boat that is about to be canceled. The cascade record stays
per departure; there is no day-level record to work from. Revisit if shops ask for one.
