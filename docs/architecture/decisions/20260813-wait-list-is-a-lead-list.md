# 20260813-wait-list-is-a-lead-list — A wait list is a set of leads the shop works, not a queue a diver holds a place in

- **Status:** Accepted
- **Date:** 2026-08-13
- **Amends:** [20260719-trip-waitlist](20260719-trip-waitlist.md), whose context says the list "must
  preserve first-come order for staff follow-up". Ordering the *display* by `created_at` stays; the
  word "must" does not. Nothing is owed to the earliest joiner.

## Context

The product said two different things about the same list, and only one of them was implemented.

`trip_waitlist_entries` carries a `created_at` and an `invited_at` and no position of any kind. When
a seat frees, nothing computes who is next: a staff member looks at the list and taps invite on
whoever they choose. Meanwhile two docblocks in `src/db/waitlist.ts` described the unbuilt stage 2 as
*"auto-invite position 1 on a cancellation"*, the staff list rendered a numbered rank badge down its
left edge, and the diver was told on joining that *"the shop can see your place in line"*.

There is no position 1. There is a set of rows with timestamps.

The gap that mattered was the diver's. Everybody brings the same expectation to the phrase *wait
list*: I am in line, and if someone drops out, the people ahead of me get asked first. DiveDay
implied it in copy, did not implement it, and gave the diver no way to see that they had been passed
over — the invite is a private email and the list is a staff surface.

## Decision

**The wait list is an unordered set of leads. The shop invites whoever fits the departure, and the
product says so in every place it speaks.**

- **Nothing is promised on joining.** The confirmation reads "A spot is not held yet. The shop has
  your details and will get in touch if a seat opens up." No place, no line, no position — in both
  locale bundles.
- **The invite mail stops claiming a standing.** "you're next on the wait list" becomes "the shop is
  offering it to you", and the footer's "Seats go first-come" becomes "The seat isn't held for you"
  — which is the true and more useful urgency, since an invite really does not reserve anything.
- **The staff list loses its rank badge.** A numbered `<ol>` was the queue claim rendered on the one
  surface where the choice gets made. It is a plain list now, still ordered by `created_at` — with
  the date each diver asked shown beside their email. The longest wait stays visible; it just is not
  a ranking.
- **`created_at` is a fact, not an entitlement.** It orders the staff display, the CSV export, and
  the send order of a last-minute deal to the people already waiting on that exact trip. None of
  those is a promise to the diver, and no surface presents them as one.
- **Any later auto-invite picks by fit, not by rank.** The stage-2 docblocks no longer define a
  "position 1" for a future build to implement. That build is separately blocked on H-09.

## Alternatives considered

**A queue with recorded exceptions** — order by `created_at`, show the diver their position, let
staff invite out of order with the skip recorded. Fairer, and it matches what divers already assume.
Rejected because the exception is not the edge case: when one seat frees on a two-tank charter and
the longest wait is an unpaid, unwaivered first-timer while the fourth name is a carded regular who
can be at the dock in an hour, the shop wants the regular, and that is the boat leaving on time
rather than favouritism. A queue whose skip button is used most days is a lead list that generates
paperwork and an audit trail nobody reads.

**A strict queue with no skipping.** Simple to explain and simple to build, and it takes the shop's
judgement away on the one call where readiness gating makes judgement necessary.

**Leave it ambiguous.** Rejected on the ground that made this a decision at all: the diver's
expectation and the shop's discretion were both live at once, and only one of them can be satisfied.
Saying nothing meant the diver kept believing the wrong one.

## Consequences

- A diver reading the join confirmation now gets an accurate picture and a slightly colder one. That
  is the trade: the shop keeps its discretion, and the diver is not misled about having earned a
  place by being early.
- Five user-facing strings changed in both locales; one staff key (`trips.waitlist.joined`) is new.
- The staff wait-list card changes shape — the rank badge is gone and an "Asked 3 Aug" cue takes its
  place beside the email. Expect a visual diff on the trip Guests tab.
- Nothing about capacity, readiness, manifests, or money moves. The list stays what
  20260719-trip-waitlist made it: demand recorded outside bookings.
- If a shop ever *wants* to sell a genuine queue to its divers ("you are number 3"), that is a new
  feature with a new promise attached, not a reading of this table.
