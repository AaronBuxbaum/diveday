# 20260816-trip-invitations-are-outreach — Invite a lead without silently claiming a seat

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** [20260813-wait-list-is-a-lead-list](20260813-wait-list-is-a-lead-list.md) only by
  adding a separate outreach record; it does not change what the wait list promises.

## Context

The Requests surface has information a shop needs before putting a departure on the board: who
asked, what they wanted, when they could go, and how many divers were in the party. A staff member
also needs to be able to start a departure with those people in mind without turning a hopeful lead
into a booking or a hidden seat hold.

The wait list cannot carry this meaning. It belongs to one already-full departure, while a date
request may be suitable for several future departures and may be used before any departure exists.
Conversely, a shop may want to contact someone about a departure without putting them on its
manifest. Reusing `bookings` would make capacity, payment, waiver and readiness code believe the
person had committed. Reusing `trip_waitlist_entries` would make a request look like demand for a
full trip and would lose the distinction between a lead and an outreach attempt.

## Decision

**`trip_invitations` is a separate, trip-scoped outreach record.** It is deliberately not a seat,
not a booking, and not a readiness signal.

- The Requests page links into the schedule builder with the selected request ids. The builder
  shows the request details and a transparent head-count recommendation; staff can uncheck anyone
  before creating the departure.
- Creating a one-off departure attaches the selected requests as invitations. Creating a recurring
  departure attaches them only to the first seeded occurrence, because later occurrences are
  independent trips and need their own outreach decision.
- One request may be attached to multiple trips. A unique trip/request key makes retries harmless,
  while leaving the original request as the durable lead record.
- A trip's Guests page shows these invitations separately from bookings and the wait list. Staff can
  prepare an email or copy a message through the existing browser composer, at no provider cost;
  recording that action sets `invited_at`. A future provider-backed sender can replace the composer
  without changing the invitation or booking boundary.
- The source is explicit (`date_request`, `waitlist`, or `direct`) and the database check requires
  exactly the matching source reference. Direct existing-diver invitations are available from the
  Guests tab; the wait-list source remains available for a future one-tap outreach bridge without
  making either one look like a date request.
- The export carries invitations with trip context and contact names. It carries no credentials,
  card data, or provider delivery state.

## Recommendation boundary

The first advisor is a framework-free, deterministic head-count heuristic: missing party sizes
count as one, known party sizes are summed, and the suggested capacity rounds up in six-seat steps
with a bounded maximum. Its result is labeled as a planning suggestion, not a boat assignment or a
boarding decision.

The advisor is an injected function (`src/lib/request-advisor.ts`), so a later transparent scoring
rule or a separately approved language model can be added without coupling Requests to a provider.
Any future model may summarize or rank leads, but it may not clear certification, waiver, medical,
payment or readiness requirements, and it must remain optional and cost-bounded.

## Alternatives considered

- **Convert requests straight into bookings.** Rejected: it consumes capacity and implies a
  commitment before the diver accepts the invitation.
- **Use the wait list.** Rejected: a wait-list row means interest in a full existing trip; a request
  can create demand for several future trips and exists before a trip does.
- **Call an LLM for every date group.** Rejected for now: a deterministic count is explainable,
  free, fast and sufficient for the current boat-day capacity model. The advisor seam preserves an
  upgrade path if real usage proves it useful.
- **Import or copy payment methods while inviting.** Rejected: an invitation is outreach, not
  payment authorization. Historical payment facts remain inert import history, and a new Stripe
  PaymentMethod must be created by a customer-consented provider flow rather than copied from a
  file.

## Consequences

- Staff can move from a grouped request day to a real departure without losing the request context
  or manually retyping names.
- Staff can invite people without inflating booked counts, manifests, readiness blockers or
  payment totals.
- The first version intentionally prepares outreach in the browser rather than sending automatically;
  the product records that the action happened, not a provider delivery receipt it did not receive.
- The request table remains the source of truth for the lead. Invitations are the trip-specific
  relationship and can be added again for another departure.
