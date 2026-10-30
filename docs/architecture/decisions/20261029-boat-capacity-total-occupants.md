# 20261029-boat-capacity-total-occupants — Count assigned crew inside boat capacity

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Issue #1703 separates a trip's passenger places from the hull's occupant limit. The stored boat
numbers were entered as passenger-seat counts, but the operator chose to keep them unchanged and
reinterpret each as total occupants aboard. The earlier capacity wording in
[20260804-boat-resource-model](20260804-boat-resource-model.md) and its configured-capacity note
are amended only for this meaning; the optional boat-resource and buyout decisions remain.

## Decision

`boats.capacity` is total occupants, passengers plus crew. `trips.capacity` remains passenger
places. At each seat-grant or availability read, effective passenger capacity is the lowest of the
trip's passenger places, its boat's recorded passenger-certificate limit when present, and the
boat's total capacity minus one place for each assigned crew member. Boat capacity and the
passenger certificate are distinct limits. Total-person certificate checks remain separate from
booking capacity.

Crew assignments may reduce a departure's effective capacity below existing bookings. Preserve
those bookings; block later grants until the count is below the new limit. No value backfill or
schema migration is needed.

Seat grants and crew assignment changes serialize on the trip row. Capacity reads then take a
shared boat-row lock. Boat edits lock affected live scheduled trips in stable id order before the
boat row, keeping the same trip-then-boat order. This makes a concurrent booking observe either
the old crew/capacity state or the new one.

## Alternatives considered

- Keep boat values as passenger seats — rejected because the chosen meaning counts all occupants.
- Add stored crew-adjusted boat capacity — rejected because crew is assigned per departure and
  values must remain unchanged.
- Remove bookings when crew grows — rejected; a crew edit records the real manifest and does not
  erase prior reservations.

## Consequences

Schedule and booking readers derive passenger availability from current assigned crew. Staff may
see existing bookings exceed that limit after crew changes; no existing reservation is deleted.
Revisit only if boats gain independently managed passenger-seat and total-occupant limits.
