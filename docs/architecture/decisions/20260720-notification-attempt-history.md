# 20260720-notification-attempt-history — Keep an append-only notification delivery attempt history

- **Status:** Accepted
- **Date:** 2026-07-20

Supersedes [20260718-notification-delivery-status](20260718-notification-delivery-status.md).

## Context

[20260718-notification-delivery-status](20260718-notification-delivery-status.md) stored only the
latest delivery state per booking and notification kind and explicitly rejected persisting a full
attempt history as "unnecessary for the immediate visibility requirement." Staff retry then became a
real requirement: an owner who sees a failed booking confirmation needs to re-send it and needs the
prior attempts to remain visible for follow-up and audit. Latest-status-only cannot express "we
tried three times" or survive a successful retry without erasing the failure that prompted it.

## Decision

Keep the denormalized latest state in `notification_deliveries` (one row per booking + kind, as
before) **and** add an append-only `notification_delivery_attempts` trail: every send or retry
appends one immutable attempt row (status, provider message id when sent, attempt time, tenant
scope), while the `notification_deliveries` row continues to hold the current status the dashboard
reads. Staff can retry a failed booking confirmation from the dashboard
(`retryBookingConfirmation`), which appends a new attempt and updates the latest state; waiver links
re-issue instead, since their one-time token is never stored. Attempt rows are never mutated or
deleted for a still-active booking. See `src/db/schema.ts` (`notificationDeliveries`,
`notificationDeliveryAttempts`) and `src/db/notifications.ts`.

## Alternatives considered

- **Keep latest-status only (the superseded decision)** — cannot support retry, an attempt count, or
  an audit trail; a successful retry would silently erase the failure record.
- **Drop the denormalized latest row and derive status from the attempt trail** — a clean single
  source, but every dashboard read would aggregate the trail; the denormalized row keeps the common
  "show unresolved issues" query cheap.
- **A full generic outbox/queue with scheduled automatic retries** — more operational machinery than
  the manual staff-triggered retry needs today; still open as future notification work.

## Consequences

Owners get a durable, auditable delivery history and a one-click retry without a support or
log-inspection step, while the dashboard's unresolved-issue query stays a single indexed lookup on
`notification_deliveries`. The cost is one extra append per send and a table that grows with
attempts; if it ever needs bounding, attempts can be pruned or archived by age since the latest
state does not depend on retaining them. Revisit if automatic retries, provider delivery receipts,
or multi-channel history arrive — those would likely promote the trail into a real outbox.
