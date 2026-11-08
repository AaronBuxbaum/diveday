# 20261104-move-a-party-as-one — A party moves between departures in one transaction

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

[20261013-staff-move-a-seat](20261013-staff-move-a-seat.md) refuses a seat that leads a party
(`leads_party`) and noted "a party moves one seat at a time; revisit if shops ask". A family of four
booked together was moved one follower at a time and then the lead, and every follower lost the
party link on the way, so the new roster showed four strangers (#2556).

## Decision

`moveParty` in `src/db/bookings.ts` moves the lead and every live follower in **one transaction**
and keeps `party_lead_booking_id`. It amends the seat-move ADR; the rest of that ADR stands.

- **The same refusals, once.** Both trips are locked in id order, then each seat goes through the
  code a single seat does (`moveBookingIn`), followers first and the lead last. The target's lock
  is held throughout, so each seat's capacity, diver and course-ratio checks already count the ones
  before it: the check is against the combined head count with no second rule to drift. Any refusal
  rolls the whole party back and names the seat that stopped it.
- **Still refused:** a seat on a buddy team (teams are rebuilt on the boat), at roll call, already
  checked in, or a no-show. A cancelled follower is not part of the party and stays behind.
- **Each person is told once.** `moveParty` in `src/features/seat-diver/store.ts` gives every seat what a
  single moved seat gets: its own waiver, `trip_rescheduled` notice, fly-safe correction and trail
  lines. Manifests refresh once per trip.
- **The door** is the lead's own "Move to another departure": its form names the party of N, offers
  only departures with room for all, and posts `party=1`. A follower still moves alone and leaves
  the party.

## Alternatives considered

- **A party-wide capacity pre-check** beside the per-seat rules: a second rule to keep in step.
- **Moving followers one at a time with a "keep the party" flag**: leaves a half-moved family when
  the lead is refused.

## Consequences

- One transaction holds N seats' locks; parties are a handful of people, so it stays short.
- A refusal says which rule stopped the party, not which person; the roster shows who is where.
