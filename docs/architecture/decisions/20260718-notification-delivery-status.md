# 20260718-notification-delivery-status — Keep the latest notification delivery status per booking

- **Status:** Superseded by [20260720-notification-attempt-history](20260720-notification-attempt-history.md)
- **Date:** 2026-07-18

## Context

The initial Resend integration logs a failed booking confirmation or waiver-link email only on the
server. That gives an owner no way to notice a production configuration, provider, or transport
problem. The alert must survive a request and be tenant-scoped, but email still cannot alter a
completed booking or waiver record.

## Decision

Store one latest `notification_deliveries` row for each booking and notification kind. It records
only the delivery state, provider message ID when sent, and attempt time; it does not duplicate
recipient email, raw provider response, or a waiver bearer token. The dashboard displays failed or
unconfigured rows for active bookings and links to the affected trip. A later successful send for
the same booking and kind replaces the issue state.

## Alternatives considered

- **Keep failures in server logs** — invisible to the shop owner who needs to follow up.
- **Persist a full outbox and attempt history** — valuable for retries and audit, but unnecessary
  for the immediate visibility requirement and substantially more operational machinery.

## Consequences

Owners can see a compact, actionable delivery warning without a support or log-inspection step.
This is latest-status visibility, not a durable retry queue, provider delivery proof, or complete
communication history; those remain future notification work. Cancelling a booking removes its
old delivery issue from the active dashboard view.
