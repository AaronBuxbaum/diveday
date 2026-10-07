# H-15: The codebase review's "Human-owned decisions" item 2: most staff mutations trust role-bearing JWT state…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

The [codebase review](../../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md#context)'s "Human-owned decisions" item 2: most staff mutations trust role-bearing JWT state until the next sign-in. What is the tolerated disable/demotion delay, and is a shared `requireActiveStaffSession` database recheck needed?

## Minimum outcome to record

**Decided 2026-07-24: accept the existing default, no change.** `src/lib/auth.config.ts` already uses Auth.js's own default session lifetime (30-day `maxAge`, 1-day `updateAge`) with no override — a disabled/demoted staff member's session can keep stale roles for up to 30 days. The product owner confirmed this is an acceptable, non-aggressive tolerance; no `requireActiveStaffSession` recheck was added.

## Unblocks / follow-up

None — no code change. Revisit only if a specific incident or compliance requirement narrows the acceptable window. See [20260724-staff-session-and-capability-migration-policy](../../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md).

Part of the [human decision log](README.md#decision-register).
