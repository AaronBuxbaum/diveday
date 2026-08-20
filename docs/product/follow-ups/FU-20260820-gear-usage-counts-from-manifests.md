# FU-20260820-gear-usage-counts-from-manifests — Consider dive-count service triggers fed by the manifest

- **Status:** Open
- **Raised:** 2026-08-20 — the gear-register build; surfaced by the industry research behind it
- **Kind:** improvement
- **Effort:** L
- **Touches:** `src/db/gear.ts`, `src/lib/gear.ts`, `src/db/manifests.ts` (read-only), `src/db/schema.ts`

## What I noticed

Manufacturer service intervals are dual-clocked in the real world: months *or* dives, whichever
first (ScubaPro publishes 24 months / 100 dives; rental fleets often service by use). The
register ships date clocks only. Meanwhile DiveDay already knows, per departure, which units were
checked out and how many dives the trip planned — a checked-out reservation on a two-dive boat is
two uses of that regulator. Shops on ScubaBoard describe hand-counting exactly this in
spreadsheets ("serviced every 50–75 dives, retire at 375"). Nobody's software does it; DiveDay's
manifest spine could, honestly and automatically.

## Why it isn't already done

A genuinely new mechanism (usage accrual + a second trigger dimension + per-unit thresholds),
not a slice of the register — and it needs a data-quality call: uses accrue from *reservations*,
which staff may not keep perfectly, so an auto-count can undercount and must present itself as
"at least N dives since service", never as a fact. That framing deserves its own design pass.

## Proposed change

A `use_count`-style accrual derived (not stored) from returned reservations joined to their
trips' `planned_dives` since the unit's last `service` event, surfaced on the unit page as "~N
dives since last service" and folded into `gearServiceState` as a second way a clock can read
due-soon when the shop sets a per-kind dive threshold. Not proposing: per-dive check-in
ceremonies or making staff log dives per unit — the whole value is that it rides records that
already exist.

## Prompt

```text
Read src/lib/gear.ts (gearServiceState, GEAR_SERVICE_INTERVAL_MONTHS), src/db/gear.ts
(latestServiceClocks, listTripGearAssignments), and src/db/schema.ts's trips.planned_dives.
Design and build dive-count-aware service state: derive uses per unit from returned
gear_reservations joined to their bookings' trips since the unit's newest 'service' event,
present it on the unit page as an "at least N dives" figure (undercount-honest wording in both
locales), and let a per-kind threshold (start with a constant in src/lib/gear.ts, no settings UI)
contribute a due_soon/overdue state alongside the date clocks, with unit tests for the accrual
math and the state merge. Done means pnpm check green. Delete
docs/product/follow-ups/FU-20260820-gear-usage-counts-from-manifests.md as part of the change.
```
