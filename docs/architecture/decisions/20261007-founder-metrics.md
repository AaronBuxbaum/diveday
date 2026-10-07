# 20261007-founder-metrics — The north star, activation milestones, and a Monday digest

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

[rollout.md](../../product/rollout.md#metrics--the-scoreboard) names the north star as **dive days run end to end in DiveDay per week**, and activation as a shop moving from sign-up to its first trip, first public booking, first signed waiver and first roll call. Nothing computed either, and the founder had no weekly view of the funnel: demo entries and set-up requests by page, or which shops had stopped moving. The answers were spread across analytics events nobody aggregates and staff-scoped tables nobody reads across shops.

## Decision

- **One nightly cron**, `/api/cron/founder-metrics` at 11:00 UTC, with its own Sentry monitor (`diveday-founder-metrics`). Every night it records milestones and logs the week-to-date north star (`cron_founder_metrics.computed`). On Mondays it also sends the founder digest for the previous Monday–Sunday (UTC).
- **A dive day** is one shop's local calendar day on which at least one booking's latest departure-checkpoint roll-call event is `boarded`. Counted by `countDiveDays` (`src/lib/founder-metrics.ts`, pure) over rows read by `departureRollCallEvents` (`src/db/founder-metrics.ts`). One fact stands for the whole rollout definition: `recordRollCall` refuses to board a diver at departure unless readiness is clear, so a boarded departure implies a booking, cleared readiness and a recorded checkpoint.
- **Activation milestones** are rows in `shop_milestones` (shop, milestone, reached_at, stall_alerted_at). There are six: `shop_created`, `first_departure`, `first_public_booking`, `first_signed_waiver`, `first_roll_call`, and `first_paid_month`, which is a seam with no writer until billing exists. Five are derived nightly from the shop's own rows by `syncShopMilestones`, insert-if-absent, so a reached milestone keeps its first time. A signed waiver counts only if the diver signed it themselves (not staff-recorded, not imported). `first_public_booking` cannot be derived, because stored bookings do not record whether a diver or staff made them, so the public booking action records it as it happens.
- **Real shops only.** A shop counts when it is not `isDemo` and at least one person in it has a login. That leaves out demo shops and the seeded listed shops, which have no logins, without a list of seed slugs to keep in step.
- **A stall** is a shop whose newest milestone on the activation path is 7 or more days old with the next one still missing (`activationStall`). It is reported once, keyed by the milestone the shop stalled after: `stall_alerted_at` on that row is set only after the digest that named it has left. A shop that moves and stalls again is reported again.
- **The digest** is the `founder_digest` notification kind, sent to `FOUNDER_DIGEST_EMAIL` (manual, Vercel-only; unset means no digest). It contains the north star, demo entries by source, set-up requests by source (with any whose onboarding mail never left), and the stalls. A week is claimed in `notification_rate_limit_state` (`founder-digest/<weekStart>`) before the send so two runs cannot both mail. The claim is given back if the mail did not leave, so the next night retries.
- **Demo entries are counted in `demo_entries`** (source, role, time), written beside `demo_entered`. They are not linked to the minted demo shop, so the reaper deleting that shop does not delete the count. They are kept for 400 days (`RETENTION_DAYS`).

## Alternatives considered

- **Read the analytics provider** — no provider is wired for server-side reads, and the digest would depend on a third party being up and configured.
- **Derive `first_public_booking` from `bookings`** — no stored column tells a diver's booking from a staff one, and adding one only for this would put a write path on the most guarded transaction in the app.
- **Exclude seed shops by slug** — the list lives in seed files and drifts. "Has a login" is a property of the data.

## Consequences

- The milestone history starts the day this ships. The first night backfills every derivable milestone from existing rows, but `first_public_booking` exists only for bookings made after it.
- `shop_milestones` is operational metadata about a shop, cascades with it, and is not part of the shop's export.
- The north star counts days, not trips or divers. Two boats out on one shop's Saturday is one dive day, as rollout.md intends.
