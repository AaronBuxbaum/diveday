# 20260719-recurring-trip-series — Materialize recurring trips as independent instances

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Shops run the same charter on a fixed cadence — "every Saturday two-tank." Staff want to put the
whole run on the board in one action, but each date drifts: a holiday weekend needs more capacity, a
weather week gets cancelled, one Saturday swaps its second site. The scheduling roadmap item
(`docs/product/brainstorm/staff-operations-efficiency.md`, section D) asks for a series that is
"scheduled as a series, edited as one or per instance."

Every downstream safety- and money-critical surface — bookings, capacity, manifests, roll call,
waivers, gear, payments — already hangs off a single `trips` row through `trip_id`. A recurrence
model must not fork that spine or those consumers.

## Decision

A recurring trip is **materialized**: creating a series writes one `trip_series` row (cadence and
provenance only) plus one ordinary, fully-formed `trips` row per occurrence, each carrying a nullable
`series_id` back-pointer. All rows are written in one transaction by `createTripSeries`, which shares
`insertTripInstance` with the one-off `createTrip` so dive rows and the readiness-requirement row are
wired identically for every instance.

Occurrence dates are computed by the framework-free `src/lib/recurrence.ts` in the shop's wall-clock
time, then converted to UTC per instance via `src/lib/zoned.ts`. Shifting whole days at the
wall-clock level holds the local departure time constant across a daylight-saving change. The horizon
is bounded (2–26 instances, weekly with a configurable week interval): a series is a season of
charters, not an open-ended calendar.

Once created, an instance is a normal trip. Editing or cancelling one date touches only that row; the
`series_id` is provenance the trip page reads to show "part of a series," never a live link that
rewrites siblings.

## Alternatives considered

- **Virtual/expanded-on-read occurrences (a rule plus overrides).** Rejected: every booking,
  manifest, waiver, and roll-call consumer would need a real trip row anyway, so a diver booking any
  date forces materialization. Keeping some dates virtual and some concrete splits the spine and
  invites "which representation is authoritative" bugs on exactly the safety surfaces we protect.
- **A background job that rolls the horizon forward forever.** Deferred: there is no scheduler in the
  stack yet, and an unbounded generator is hard to reason about for capacity and cancellations. A
  bounded, materialize-now window is predictable and testable today; extending it is additive.
- **A single series row that owns capacity/roster shared across dates.** Rejected: it breaks the
  per-trip capacity and manifest invariants and makes per-instance edits the exception rather than
  the default.

## Consequences

Staff schedule a whole run at once and manage each date with the existing trip tooling; no consumer
changed. The trade-off is that this slice has no series-wide edit or cancel — changing every future
date means editing them individually — and the horizon is finite, so a long-running weekly charter is
re-scheduled when it runs out. Both are contained follow-ups: series-wide operations can iterate the
`series_id` set, and a rolling horizon is a scheduler plus another `createTripSeries` window. The
`trip_recurrence_frequency` enum is `weekly`-only for now so a monthly or daily cadence is an additive
migration.
