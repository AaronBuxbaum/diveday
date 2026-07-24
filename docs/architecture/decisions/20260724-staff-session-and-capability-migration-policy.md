# 20260724-staff-session-and-capability-migration-policy — Accept default staff-JWT lifetime; confirm the readiness/confirm capability cutover was one-time

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

[The 2026-07-23 codebase review](../../product/archive/codebase-review-20260723.md)'s
"Human-owned decisions" section named two risks a smaller model must not decide alone: (2) staff
mutations trust role-bearing JWT state until the next sign-in, with no stated tolerated
disable/demotion delay; (3) whether the CR-002/CR-003 move from permanent readiness links to
expiring capabilities needed a one-time cutover or an ongoing migration policy. The product owner
resolved both on 2026-07-24 (recorded in
[human-decisions.md](../../product/human-decisions.md#decision-register) as H-15 and H-16); this
ADR records the reasoning so a future agent doesn't rediscover it or "fix" either as a bug.

## Decision

- **Staff JWT revocation window: accept Auth.js's own default, make no change.**
  `src/lib/auth.config.ts` sets `session: { strategy: "jwt" }` with no `maxAge`/`updateAge`
  override, so the session already uses Auth.js's documented defaults — `maxAge: 2592000` (30
  days), `updateAge: 86400` (1 day). The `jwt()` callback only copies `roles` from `user` at
  sign-in and never re-reads the database on refresh, so a disabled or demoted staff member's
  existing session keeps its old roles for up to 30 days of continued use, or until they sign in
  again, whichever comes first. The product owner confirmed this is an acceptable, "not
  aggressive" tolerance for this product's risk profile — no `requireActiveStaffSession` database
  recheck is being added for now. Import/export's existing current-role recheck (called out by the
  review as the one surface that already does this) is unaffected and still stands as the pattern
  to reuse if a specific high-risk mutation ever needs a tighter bound.
- **The CR-002/CR-003 capability migration was a one-time cutover, already complete — not an
  ongoing or permanent policy.** When `booking_capabilities` shipped, the old stateless-HMAC
  `src/lib/readiness-links.ts` module (and the schedule-confirmation flow's bare-UUID credential)
  were deleted outright, not kept alongside the new table as a fallback. Any link minted under the
  old scheme has had no verification path since that PR merged — `verifyBookingCapability` looks
  up a token's hash in `booking_capabilities` and a pre-cutover token was never written there, so
  it already fails closed. There was no explicit transition window and none is needed
  retroactively: the cutover is a historical fact about one migration that already happened, not a
  standing policy that governs anything going forward. A future capability-purpose change (e.g. a
  new token shape) is a new decision on its own merits, not a continuation of this one.

## Alternatives considered

- **Add a `requireActiveStaffSession` database recheck to high-risk mutations now.** Rejected for
  this ticket: the review flagged it as optional ("and whether high-risk mutations should use a
  shared recheck"), not required, and the product owner's guidance was explicitly to not be
  aggressive here. Revisit if a specific incident or compliance requirement narrows the acceptable
  window below 30 days.
- **Retroactively design a grace-period/dual-read migration for the already-shipped capability
  cutover.** Nothing to migrate — the old module no longer exists in the codebase, and any
  outstanding pre-cutover link is already dead. Building compatibility for it now would resurrect a
  removed, unauthenticated credential format for no user benefit.

## Consequences

- No code changes ship with this ADR. It exists to make two accepted-as-is decisions legible and
  prevent them from being silently revisited by a future agent who assumes an unbounded JWT
  lifetime or an open migration question is unintentional.
- If the tolerated staff-JWT window ever needs to shrink, the pattern to copy is import/export's
  current-role recheck, generalized into a shared `requireActiveStaffSession` helper — scoped to
  the specific mutations that need it, not a global session-strategy change.
- Role authority boundaries (which roles may reach payment settings, refunds, waiver templates,
  diver deletion, and trip configuration) remain a separate, larger, not-yet-implemented decision —
  tracked as **H-14** in [human-decisions.md](../../product/human-decisions.md#decision-register),
  not resolved by this ADR.
