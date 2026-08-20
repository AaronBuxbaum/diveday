# FU-20260820-gear-service-log-retention-window — Decide whether gear_service_events gets a retention window

- **Status:** Open
- **Raised:** 2026-08-20 — the gear-register build (ADR 20260815-minimal-gear-register)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/retention.ts`, `src/db/retention.ts`, `src/db/schema.ts` (`gear_service_events`)

## What I noticed

`gear_service_events` is append-only and unbounded: every service, hydro test, inspection, and
condition note on every unit, forever. Every other append-only trail in the schema either has a
row in `RETENTION_DAYS` (`src/lib/retention.ts` — activity events at 1095 days, webhook events
against Stripe's retry horizon) or a stated reason not to. This one has neither, and nothing
fails because of it — retention has no coverage test enumerating tables.

## Why it isn't already done

The retention table's own header says the windows are HD-11's call — a human's, not an agent's.
And this trail is unusual: a unit's service history is the closest thing the register has to
liability evidence ("this regulator was serviced on schedule"), which argues for keeping it for
the unit's lifetime rather than any fixed window. Deleting a unit already cascades its history
away; retiring keeps it. That may simply be the right shape, but it should be chosen, not
defaulted into.

## Proposed change

Aaron decides one of: (a) no window — a unit's care history lives as long as the unit's row, and
`src/lib/retention.ts` gains a comment naming `gear_service_events` as deliberately unbounded; or
(b) a long window (e.g. 1825 days past the unit's retirement), registered the standard three-part
way (union member, `RETENTION_DAYS` entry, prune arm in `src/db/retention.ts`). I recommend (a):
the row volume is tiny (a few hundred a year for a large fleet) and the evidence value is
lifetime.

## Prompt

```text
Read src/lib/retention.ts's header, docs/architecture/decisions/20260815-minimal-gear-register.md
(the service-history amendment), and src/db/schema.ts's gear_service_events. Record the owner's
retention decision for gear_service_events: either add a comment in src/lib/retention.ts naming
it deliberately unbounded (with the liability-evidence reasoning), or register a window the
standard way (RetainedTable union member + RETENTION_DAYS entry + a prune arm in
src/db/retention.ts keyed on serviced_on, with a test in src/db/retention.test.ts). Done means
pnpm check is green. Delete
docs/product/follow-ups/FU-20260820-gear-service-log-retention-window.md as part of the change.
```
