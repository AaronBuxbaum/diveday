# 20260723-event-instrumentation — A typed custom-event seam over Vercel Analytics

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

Page-level analytics already ships: the Vercel `<Analytics />` component in the root layout
records route views automatically. What it cannot see is the product's own moments — where staff
hit a readiness blocker, how often they clear it in place, and where a diver abandons a paid flow.
The delight backlog asks for exactly this: instrumentation for abandonment, blocker frequency, and
staff recovery paths, beyond the page view.

The risk with ad-hoc `track("...")` calls sprinkled across call sites is two-fold: the set of things
we measure becomes un-auditable (no one place lists the events), and a telemetry hiccup can surface
inside a user flow if a call isn't defensively wrapped.

## Decision

One seam, `src/lib/analytics.ts`, mirroring the notification and storage seams:

- **A typed `AnalyticsEvent` union** is the vocabulary. Adding a measurable moment means adding a
  variant here, so the full set is reviewable in one file and every consumer shares the same prop
  shapes. The first three: `staff_recovery` (a blocker cleared in place, with `kind` and `surface`),
  `blockers_surfaced` (how many divers still can't board when Today loads), and `checkout_abandoned`
  (a pay-at-booking checkout the diver never completed).
- **`trackEvent(event)` is best-effort by construction.** It splits the event name from its props,
  forwards to Vercel's server-side `track`, and swallows any error — telemetry is observational,
  never load-bearing. The tracker is injectable so the seam is unit-tested without a provider.
- **Recovery events fire from the server actions** that perform the recovery (waiver send,
  confirmation resend), where the outcome and surface are known. **`blockers_surfaced` fires from the
  Today page via `after()`**, so measuring the queue never delays rendering it.

## Alternatives considered

- **A dedicated analytics provider (PostHog, Plausible) now.** More capability, but a new runtime
  dependency and account for a signal the existing Vercel integration already carries. The seam keeps
  the provider swappable — a later move is a one-file change behind `trackEvent`.
- **Inline `track()` at each call site.** Fewer files, but no central vocabulary and easy to forget
  the defensive wrapper; the first un-wrapped call that throws inside a booking flow is the argument
  against it.
- **Instrument in the `src/db` query layer.** Rejected: it puts telemetry concerns in the data layer
  and fires on reads that aren't user intent. Events belong at the action/page boundary where intent
  is unambiguous.

## Consequences

- Product questions — how often boats are blocked, whether one-tap recovery is used, where checkouts
  leak — become answerable without touching the flows that generate them. The event set is typed and
  lives in one file.
- `checkout_abandoned` has its event shape defined but is wired opportunistically as the
  checkout-expiry path grows a hook; the type existing keeps that a one-line addition, not a reshape.
- **Escape hatch:** if event volume or query needs outgrow the Vercel integration, swap the provider
  inside `trackEvent` (and add an ADR); no call site changes.
