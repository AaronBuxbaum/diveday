# 20260718-resend-transactional-email — Use Resend behind a transactional notification seam

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

M2's public booking flow holds a diver's spot but did not confirm it outside the browser. M3 staff
can create a secure waiver-completion link but had to copy it manually. Resend is now configured
for production, but booking, waiver, and future notification flows must not depend directly on a
vendor SDK or allow an email failure to undo authoritative operational records.

## Decision

Use one server-only `notify()` seam in `src/lib/notifications/`. Its Resend adapter calls the
`POST /emails` REST endpoint through the platform fetch API; no SDK dependency is required. The
adapter is selected only when `RESEND_API_KEY` and the verified `RESEND_FROM_EMAIL` sender are
configured. It sends immediate transactional booking confirmations and staff-triggered waiver
links. Waiver URLs use the explicit `APP_HOST` canonical origin, never an untrusted request
header.

Each send uses a stable Resend idempotency key derived from the booking or waiver-record ID. The
booking and waiver writes complete first; a failed, missing, or malformed notification is logged
without changing the successful booking or exposing a waiver token in logs. Local development and
tests use the disabled provider unless configuration is explicitly supplied.

## Alternatives considered

- **Call Resend from each Server Action** — quick initially, but duplicates vendor behavior and
  makes templates, testing, retries, and a future provider swap unnecessarily risky.
- **Add the Resend Node SDK** — unnecessary for the two supported REST operations and another
  runtime dependency to maintain.
- **Make email delivery part of the booking transaction** — a provider outage must never release
  or hide a capacity-safe booking.

## Consequences

Booking and waiver emails are immediately useful in production while the provider is isolated and
testable with no credentials. Resend deduplicates an identical idempotency key for 24 hours; this
is not a durable outbox, delivery history, or retry system. Add those capabilities before relying
on email for safety-critical escalation, and revisit this ADR if a different email provider,
multi-channel messaging, or durable notification state is required.
