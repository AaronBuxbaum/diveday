# 20260802-sns-sms-adapter — Swap Twilio for AWS SNS behind the same SMS seam

- **Status:** Accepted
- **Date:** 2026-08-02
- **Supersedes:** [20260721-sms-whatsapp-notifications](20260721-sms-whatsapp-notifications.md)

## Context

[20260721-sms-whatsapp-notifications](20260721-sms-whatsapp-notifications.md) added the courtesy
SMS channel used by the scheduled reminder cadence and the post-trip recap, behind a Twilio-backed
`SmsProvider` seam. That Twilio account was never actually provisioned — `TWILIO_*` stayed unset in
every environment, bypassed in `scripts/check-env.mjs` — so the channel shipped dormant. The product
owner's decision now, having already stood up an AWS account and IAM conventions for
[SES email](20260802-ses-adapter-and-webhook.md), is to send the courtesy SMS through **AWS SNS**
instead of onboarding a second vendor (Twilio) for a channel that hasn't gone live yet — one fewer
account to register, and it reuses the same AWS billing/IAM/least-privilege posture already built out
for SES. The `SmsProvider` interface itself is kept exactly as designed — a swappable seam, so a
different provider (Twilio again, or another) can be substituted later without touching call sites in
`src/db/reminders.ts`/`recap.ts` if a real need for it appears.

WhatsApp is dropped from this seam entirely, not carried forward: AWS SNS has no WhatsApp delivery
path at all (that's a distinct Meta Business API integration Twilio happened to front as a
convenience), and — as the superseded ADR's own follow-up confirmed — no WhatsApp UI or copy was
ever wired up anywhere in the app. Carrying a `channel: "sms" | "whatsapp"` field for a value no
provider can serve and no caller ever passes is exactly the unused-carrying-cost this record is
meant to avoid. Add a WhatsApp adapter alongside this one, behind the same interface, if that's ever
explicitly requested.

## Decision

- **One texting provider seam, AWS SNS, via the AWS SDK.** `src/lib/notifications/sms.ts` keeps
  `SmsProvider.send({ to, body })` and `notifySms()`/`smsProviderFromEnvironment()` as the entry
  points, unchanged from the caller's perspective. Internally, `snsSmsProvider` replaces
  `twilioSmsProvider`, calling `SNSClient`'s `Publish` command directly to a phone number
  (`PhoneNumber`, no `TopicArn`) rather than a fetch-based Twilio Messages POST.
- **`@aws-sdk/client-sns` joins `@aws-sdk/client-sesv2` as a second AWS-SDK exception to the
  no-SDK/fetch-based house style**, for the identical reason the SES ADR gives: correctly-tested
  SigV4 signing beats a hand-rolled crypto surface, and the SDK's client shape (`client.send(command)`)
  is exactly what the SES adapter's `SesEmailClient` test-injection pattern already established —
  `SnsPublishClient` mirrors it directly, so a test fakes `{ send: vi.fn() }` instead of a real client.
- **Dedicated, distinctly-named AWS credentials**: `SNS_AWS_REGION` / `SNS_AWS_ACCESS_KEY_ID` /
  `SNS_AWS_SECRET_ACCESS_KEY`, explicitly passed to the `SNSClient` constructor — never the SDK's
  default credential-provider chain, for the same reason the SES ADR rules it out (a running app
  process must never implicitly inherit a more powerful ambient credential). A dedicated
  `diveday-sns-sms-sender` IAM user (`infra/lib/infra-stack.ts`) is scoped to `sns:Publish` alone —
  no topic management, no subscribe/unsubscribe, nothing else.
- **Error classification mirrors `sesErrorInfo`.** SNS SDK exceptions carry the same
  `$metadata.httpStatusCode` + `.name` contract every AWS SDK v3 client exposes, so
  `snsErrorInfo` in `sms.ts` applies the identical retryable/non-retryable split (429/5xx retryable,
  a network-level failure with no `$metadata` retryable, everything else not) rather than
  reinventing the classification.
- **`SmsDelivery`'s failed variant gains the same optional fields as `NotificationDelivery`**
  (`retryable`, `httpStatus`, `errorCode`, `detail`) for parity and because `recordNotificationDelivery`
  already accepts either shape — this was previously a bare `{ status: "failed" }` under Twilio,
  which threw away information the SES-equivalent classification now provides.
- **`SmsMessage` drops its `channel` field.** `{ to, body }` is the whole shape now; every call site
  already only ever passed `channel: "sms"`.

## Alternatives considered

- **Keep Twilio, just wire it up for real.** Rejected by the product owner: onboarding a second
  vendor account (with its own billing, dashboard, and credential rotation story) for a channel that
  was never live has no advantage over reusing the AWS account and IAM conventions already stood up
  for SES, and SNS's direct-to-phone-number `Publish` is materially simpler to integrate than Twilio's
  REST API (no account SID/auth token pair, no per-message form-encoded body).
- **A generic multi-provider abstraction (SNS/Twilio/MessageBird/…) from day one** — still premature,
  same reasoning as the original ADR: one provider behind a seam is enough, and the seam already
  isolates the choice if a second is ever needed.
- **Keep the `whatsapp` channel as a documented no-op** — rejected; a channel value no configured
  provider can ever serve is dead weight in the type system and every switch/test that has to account
  for it, for a feature nobody has asked for.
- **Reuse the existing `SesEventNotificationsTopicArn` SNS topic for outbound SMS** — rejected as a
  conflation: that topic is a *subscription target* for inbound SES event notifications (a different
  SNS use entirely). Outbound SMS via `Publish` needs no topic at all; the two SNS use cases share a
  service, not a resource.

## Consequences

- Adds a second AWS SDK runtime dependency (`@aws-sdk/client-sns`), alongside `@aws-sdk/client-sesv2`
  — both departures from the fetch-based house style are now consolidated under the same
  "AWS SigV4 signing is the exception" reasoning, rather than each carrying its own one-off
  justification.
- The courtesy-SMS channel remains dormant until `SNS_AWS_*` credentials are actually minted and set
  (same posture as before the migration: `not_configured` until then), so this is not a production
  behavior change on its own.
- WhatsApp is gone from the type system, not just unwired — re-adding it (for SNS or any provider)
  means writing a new, additive channel behind `SmsProvider`, not restoring removed code, since AWS
  SNS itself has no such delivery path to fall back to.
- Revisit if a real need for a second texting provider (or WhatsApp specifically) appears — the
  `SmsProvider` interface's whole purpose is to make that a new implementation behind the existing
  seam, not a rewrite of `src/db/reminders.ts`/`recap.ts`.
