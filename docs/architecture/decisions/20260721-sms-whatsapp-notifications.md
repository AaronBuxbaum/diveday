# 20260721-sms-whatsapp-notifications — SMS and WhatsApp as notification channels

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

[Transactional email](20260718-resend-transactional-email.md) shipped the `notify()` seam and the
[delivery-status](20260718-notification-delivery-status.md) tracking behind it, all single-channel
(email via Resend). H-09's remaining scope names SMS and WhatsApp as channels the market expects
(DiveAdmin ships a unified email/SMS/WhatsApp inbox), and the scheduled-reminder cadence
([20260721-scheduled-reminder-cadence](20260721-scheduled-reminder-cadence.md)) wants a second
channel for divers who read a text but not email. This ADR adds the texting seam.

## Decision

- **One texting provider seam, Twilio, fetch-based.** `src/lib/notifications/sms.ts` exposes
  `SmsProvider.send({ channel, to, body })` with `channel` of `sms` or `whatsapp`, and
  `notifySms()`/`smsProviderFromEnvironment()` as the entry points — the exact shape as the Resend
  and Stripe seams, so it needs no new runtime dependency. WhatsApp is the same Twilio Messages call
  with a `whatsapp:` prefix on both numbers. A channel whose sender (`TWILIO_SMS_FROM` /
  `TWILIO_WHATSAPP_FROM`) is unset returns `not_configured` rather than sending from a blank From;
  with no Twilio credentials at all the provider is the disabled one.
- **Numbers must be dialable or we don't text.** `smsRecipient(phone)` cleans a stored number and
  accepts it only if it is already E.164 (`+<country><number>`). It never guesses a country code, so
  a local "555-1234" yields null and the caller skips SMS instead of texting the wrong person.
- **Delivery tracking stays single-channel per row for now.** `notification_deliveries` still holds
  one tracked channel per (booking, kind). A reminder tracks email when the diver has one and the
  SMS result only when they are phone-only; an accompanying courtesy SMS is best-effort and not
  separately rowed. Per-channel delivery rows are a deliberate future slice, called out here so the
  gap is honest.

## Alternatives considered

- **Twilio SDK** — the SDK adds a dependency and an ADR for it; every other provider here is
  fetch-based against a documented HTTP API, and texting is a two-field POST. Fetch keeps the seam
  testable with a fake `fetch` and matches the house style.
- **A generic multi-provider abstraction (Twilio/MessageBird/…)** — premature; one provider behind a
  seam is enough, and the seam already isolates the choice if a second is ever needed.
- **Add a `channel` column to `notification_deliveries` now** — the honest multi-channel model, but
  it ripples through the delivery dashboard and its tests for little immediate gain while email
  remains the primary channel. Deferred, not foreclosed.

## Consequences

- Booking and reminder flows can now reach divers by text or WhatsApp, closing the channel half of
  H-09, with the same graceful-degradation guarantee every other provider has: unconfigured means
  `not_configured`, never a crash or a send to a bad number.
- No new runtime dependency enters the repo; the seam is fully exercised in tests with a fake fetch.
- Multi-channel *delivery observability* is intentionally partial (one tracked row per reminder);
  the follow-up to row per channel is recorded above rather than pretended complete.
