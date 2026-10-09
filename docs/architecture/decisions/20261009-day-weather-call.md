# 20261009-day-weather-call — One weather call for a whole morning or day

- **Status:** Accepted (2026-10-09)
- **Date:** 2026-10-09

Builds on [20260804-blowout-cascade](20260804-blowout-cascade.md), which made a blow-out one call per
departure, and [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md),
which made that call refund card seats by itself. Amended the same day after a dive-domain review and a
security review (see "Review amendments, 2026-10-09").

## Context

Weather that closes the harbour closes it for every boat that morning. The blow-out was called
one departure at a time: five pages, five confirms. Worse, calling the 08:00 boat first offered
its divers the 10:30 boat as an alternative, and the next tap cancelled that one too. The product
owner approved a day call on 2026-10-09, with three conditions: it reuses the per-trip blow-out so
refunds and messages behave exactly as today, and no diver is offered a sister departure the same
call cancels. (His first condition, that it be open to the same staff as the single-trip call, he
replaced after review; see below.)

## Decision

**A day page where departures are selected and reviewed, and a batch that orders the single-trip
blow-out.**

- `/shop/[shopSlug]/schedule/blowout/day/[date]` lists every live departure leaving on that shop day,
  with how many seats are booked on each and who is crewing it. **Nothing is selected when it
  opens.** Two presets select every callable departure or only those leaving before noon in the
  shop's zone ("Before noon", `MORNING_ENDS_HOUR`, `src/lib/day-blowout.ts`); the staffer can select
  any departures. A departure that was already called, is canceled, or is **underway** shows why;
  a called one links to its cascade record, and says "Messages unsent" with a "Finish sending" link
  while any diver row is still pending, sending or failed.
- **Underway** (`departureUnderway`) means its start time has passed, or anybody, diver or crew, has
  a boarding or roll-call event on it. This is stricter than the late-arrival hour (`hasSailed`)
  the booking side uses, and `setUpTripBlowout` refuses such a departure server-side, for the
  single-trip call too.
- **Two steps.** "Review the call" opens the review, which lists exactly the selected departures
  and whose one button says what it does: "Cancel 2 departures, 5 divers". Only that button calls.
- `callDayBlowout` (src/db/blowouts.ts) runs **phase one of the single-trip blow-out for every
  ticked departure first**: each in its own transaction, it cancels the trip, records the blow-out
  and snapshots the roster. Only then does it run phase two for each: refunds and messages. The
  candidate departures for every diver's alternatives are read after all of them are canceled, so
  none of them can be offered. The ids are also passed down and excluded by name.
  `callTripBlowout` is the same two phases back to back, so the two paths share every line.
- A departure the call cannot take (underway, not this shop's) is reported and the rest go ahead.
  A departure already called resumes, as calling it again alone does.
- **Nothing set up is stranded.** Each departure's setup and each one's send runs in its own `try`.
  A setup that throws is answered `failed`, and that departure is not canceled. Every departure that
  *was* set up still runs phase two. A send that throws part-way leaves its diver rows pending or
  failed, which the cascade's own resume finishes and the day page flags.
- `callDayBlowoutAction` is for **owner, manager and captain** only (`canCallDayBlowout`). The
  single-trip `callBlowoutAction` stays open to all staff. The action **re-reads the date's
  departures in the shop's zone** and calls only submitted ids that are on that day and still
  callable. Every other submitted id is counted as skipped in the `?notice=`; there is no silent
  cap. It records the same `blowout_called` trip activity per departure, each in its own `try`.
- The crew of every called departure are told at once (ADR
  [20261009-crew-hear-about-their-boats](20261009-crew-hear-about-their-boats.md)).
- The doors are where the single-trip call is reached: the departure's More list ("Weather blow-out
  for the whole day…") and a link on the single-trip confirm page. Both are shown only to the roles
  that may call a whole day.

## Alternatives considered

- **Call the single-trip blow-out in a loop.** Each departure's messages would be written while its
  sisters were still scheduled, so the 08:00 divers would be offered the 10:30 boat. This is the
  defect the order exists to prevent.
- **One transaction for the whole day.** A Stripe refund or a send cannot sit inside a database
  transaction, and the per-trip cascade is already resumable. A setup failure on the third boat
  leaves that boat scheduled and the others called with their messages sent. A send failure leaves
  that boat called and resumable from its record, which the day page flags.
- **A door on the schedule board's day header.** The header is a 72px sticky rail holding a weekday
  and a numeral. A danger action there sits beside every day of the week, including the ones with no
  weather, and the board is where departures are planned rather than called off.

## Review amendments, 2026-10-09

A dive-domain review and a security review of the first version changed it, with the owner's
decisions where a choice was his:

- **Safety:** the first version used `hasSailed` (start + 1 hour), so a boat on the water could be
  canceled, and the "all" preset selected it. Roll call then refused writes on the canceled trip.
  Now underway departures are blocked as above, the page opens with nothing selected, and roll call
  never refuses a write on a trip with any roll-call event, whatever its status
  (`scheduledOrCountingHeads`, src/db/manifests.ts).
- **Permissions (owner's decision):** the day call is owner, manager and captain only, and the
  review step states "Cancel N departures, M divers".
- **Copy:** "Before noon" / "Antes del mediodía"; US English "select", not "tick"; es-ES "Ya
  cancelada por mal tiempo" for a called departure.
- **Partial failure (security M1)** and **server re-filter (security L2)** as above.

## Consequences

An owner, manager or captain calls off a morning with one selection and one confirm. Every diver
gets exactly the message a single call would have sent, nobody is offered a boat that is about to be
canceled, and no boat that may have people aboard can be called off. The cascade record stays
per departure; there is no day-level record to work from. Revisit if shops ask for one.
