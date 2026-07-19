# 20260719-trip-waitlist — Keep full-trip demand separate from bookings

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Divers need a way to express interest when a charter is full. A wait-list request is not a seat,
must not affect capacity, readiness, payments, or the manifest, and must preserve first-come order
for staff follow-up.

## Decision

Store one `trip_waitlist_entries` row per shop, trip, and person. The public action accepts entries
only for scheduled future trips that are full at submission time; it deduplicates by the existing
shop-scoped person email and never creates a booking. Staff see entries ordered by `created_at` on
the trip page. This slice does not send automatic offers or promote entries when a booking is
cancelled.

## Alternatives considered

- **Use a booking status for wait-listed divers** — rejected because it risks counting demand as
  capacity and leaking unconfirmed divers into safety-critical booking consumers.
- **Email the next diver automatically on cancellation** — deferred until an offer, expiry, and
  acceptance policy are explicitly designed.

## Consequences


Staff get a durable, ordered demand signal without compromising the capacity or manifest invariant.
They manually contact divers when room opens. Revisit this when the shop needs automated offers;
adding offer state and a notification trail to this table is a contained migration.
