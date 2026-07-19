# 20260719-trip-dive-briefings — Keep shared trips and optional per-dive briefings separate

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

A boat outing is one bookable trip with shared timing, capacity, price, conditions, and readiness
requirements, but it may contain up to four separate dives. Shops often know only that a trip is a
"two-tank dive" when it is published; the diver-facing experience should still be clear without
inventing site or route details.

## Decision

Keep the shared information on `trips` and store ordered optional detail rows in `trip_dives`. Each
row may name a dive, reference a reusable dive-site briefing, and include a short diver-facing
description. The trip's `planned_dives` remains the count used by manifests and is constrained to
one through four; blank detail rows are valid and render as a transparent "details to be briefed"
state. The legacy `trips.dive_site_id` remains synchronized to the first dive for compatibility
with shared readiness and marine forecasting while consumers migrate to the ordered rows.

## Alternatives considered

- **Put a JSON array on `trips`** — rejected because per-dive site references, ordering, tenant
  validation, and future operational fields deserve database constraints and queryable rows.
- **Make every dive a separate trip** — rejected because booking, capacity, payment, waiver, and
  boat-day conditions are shared; splitting them would make the customer book the same boat twice.
- **Require every dive to have a site** — rejected because operators commonly publish a two-tank
  outing before choosing the second mooring and must not be pushed into fabricated details.

## Consequences

Staff can publish a polished one-to-four-dive plan incrementally, while divers see only details the
shop actually supplied. Readiness and forecast behavior remain backward-compatible through the
first-dive compatibility field. Per-dive readiness gates and per-dive conditions remain future
extensions; this slice is briefing and itinerary detail, not a second safety authorization path.
