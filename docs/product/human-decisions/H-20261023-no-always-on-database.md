# H-20261023-no-always-on-database: Keep the database awake at the pilot, or retry a cold connect?

- **Status:** Implemented
- **Human owner:** Aaron Buxbaum

## Decision or approval needed

**Neon suspends the compute after five idle minutes, so the first desk request after a lull lands
on a cold database** (the 2026-10-23 code pre-mortem, item 6). The pool gave up after five seconds
and nothing retried. ADR 20260919-health-check-does-not-wake-the-database priced always-on compute
at about $19 a month and named "a shop live on real bookings" as the moment to revisit it.

## Decision

**Decided 2026-10-23 (Aaron, in the project thread, call 3: "No — neon auto-scaling should work well
here"): no always-on compute.** Scale-to-zero stays on at the pilot. Only the retry is built.

## What ships

A connection that fails to open (a timeout or a socket error, never a refusal like a wrong
password) is tried once more before an error shows; a statement that may have run is never retried
(`retryConnectOnce` in `src/lib/db-pool-config.ts`, wired in `src/db/client.ts`). The ADR's revisit
line no longer names a shop going live as a trigger, and its 2026-10-23 amendment says not to
propose always-on again without evidence that a desk saw a cold-start error the retry did not
absorb.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
