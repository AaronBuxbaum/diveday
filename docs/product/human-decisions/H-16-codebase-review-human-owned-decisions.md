# H-16: The codebase review's "Human-owned decisions" item 3: CR-001–CR-003 replaced permanent readiness/confirmation authority with revocable…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

The [codebase review](../../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md#context)'s "Human-owned decisions" item 3: CR-001–CR-003 replaced permanent readiness/confirmation authority with revocable capabilities — was invalidating historical URLs a one-time cutover or an ongoing/permanent migration policy?

## Minimum outcome to record

**Decided 2026-07-24: it was already a one-time cutover, and it already happened.** Shipping `booking_capabilities` deleted the old `src/lib/readiness-links.ts` HMAC module outright rather than keeping it as a fallback, so every pre-cutover link has had no verification path since that PR merged — nothing further to migrate. There is no standing "migration policy" governing future capability changes; each would be its own decision.

## Unblocks / follow-up

None — already complete. See [20260724-staff-session-and-capability-migration-policy](../../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md).

Part of the [human decision log](README.md#decision-register).
