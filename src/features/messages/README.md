# messages

Every message in and out: email, SMS and WhatsApp, reminders, the staff inbox and the help
desk.

## Owns

- Sending: `sms-sender.ts`, `reminders.ts`, `reminder-links.ts`, `person-sent-messages.ts`,
  `phone-line-type.ts` (server only), `unsubscribe.ts`, `desk-pings.ts`.
- Receiving: `inbound-email.ts`, `inbound-mail-store.ts`, `email-events/`, `email-bounces.ts`,
  `sms-webhook/`, `sns-webhook/`, `whatsapp-webhook/`, `reply-keywords/`.
- The inbox and help desk: `inbox-page.ts`, `inbox-seats.ts`, `help-requests/`, `help-request-lock.ts`.
- Settings: `staff-email-page.ts`, `whatsapp-settings-page.ts`, `whatsapp-signup/`.

## Does not own

`notify()` and the renderers (`src/lib/notifications/`), the WhatsApp account store
(`src/db/whatsapp-accounts.ts`), and the words (the bundles).

## Invariants

- `notify()` is the one send entrypoint, each kind with a deterministic idempotency key; a
  reserved test domain never reaches SES; a provider rejection fails closed without exposing
  details; a diver's message goes in their recorded locale, then the shop's, never the sender's.
- Attempt history is append-only, an event applies only when newer, and an unknown message id is
  reported without failing.
- SNS and Meta signatures are verified before any event is trusted, Meta's over the raw body; an
  event that names a tenant applies only to it.
- One channel per diver per message: WhatsApp when connected, otherwise SMS, and a WhatsApp
  failure falls back to SMS. WhatsApp connects only through Embedded Signup.
