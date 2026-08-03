# 20260803-ses-sole-email-provider — Remove Resend; AWS SES is the only email provider

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

[20260718-resend-transactional-email](20260718-resend-transactional-email.md) put Resend behind the
`notify()` seam. [20260802-ses-adapter-and-webhook](20260802-ses-adapter-and-webhook.md) later added
an SES adapter as a second, opt-in provider (`EMAIL_PROVIDER=ses`), explicit and defaulting to Resend
"never a side effect of environment configuration left over from testing." That caution made sense
while both providers were live options. It no longer applies: DiveDay has no current users, is mid
DNS/infra consolidation onto AWS (Route 53, this same SES identity), and there is no reason to keep
maintaining two email transports — one hand-rolled HTTP/retry/rate-limit implementation (Resend) and
one AWS-SDK-backed implementation (SES) — for a single sender.

## Decision

- **Resend is removed entirely**, not just deprioritized: the fetch-based HTTP adapter and its
  hand-rolled retry/backoff/rate-limit machinery (`requestResend` and everything only it used) in
  `src/lib/notifications/index.ts`; the Svix webhook signature verification
  (`src/lib/notifications/webhook.ts`); the Resend event-type parsing
  (`parseResendEmailEvent` in `src/lib/notifications/events.ts`, which otherwise stays as the shared
  `ProviderEmailStatus` vocabulary every provider's event mapping still imports); the
  `/api/webhooks/resend` route; the durable per-instance rate limiter
  (`reserveResendRequest`/`notificationRateLimitState` key `"resend"`) in `src/db/notifications.ts`;
  and the `RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`RESEND_WEBHOOK_SECRET` env vars.
- **`notificationProviderFromEnvironment` no longer branches on `EMAIL_PROVIDER`.** It always builds
  an SES config from `SES_AWS_REGION`/`SES_AWS_ACCESS_KEY_ID`/`SES_AWS_SECRET_ACCESS_KEY`/
  `SES_FROM_EMAIL` and falls back to `disabledNotificationProvider` when that config is incomplete —
  the same "degrades to `not_configured`, never throws" behavior every notification path already
  depended on, just with one provider instead of a flag choosing between two. The `EMAIL_PROVIDER` env
  var is gone; there is nothing left for it to select between.
- **No replacement rate limiter for SES.** The Resend-specific throttle existed only because Resend
  has a hard per-second cap; the AWS SDK's own retry/backoff for throttling and 5xx responses (already
  the reasoning in the superseded adapter ADR) covers this. `notificationProviderForDb` no longer takes
  a `db` parameter — it had no other use once the Resend permit hook was removed.
- **This is a code-level cutover, not yet a working production email path.** The AWS-side
  prerequisites named in [20260802-ses-email-transition-prep](20260802-ses-email-transition-prep.md)
  and [20260802-ses-adapter-and-webhook](20260802-ses-adapter-and-webhook.md) — SES production access
  (an AWS Support case), DKIM DNS verification for `ses.dive.day`, minting the `diveday-ses-sender`
  IAM access key, and subscribing `/api/webhooks/ses` to `SesEventNotificationsTopicArn` — are all
  still outstanding manual steps. Until they're done, every send resolves to `not_configured`, exactly
  as it would have with no provider configured at all. Acceptable because there are no current users
  to notify.
- **The SES adapter's accepted idempotency gap** (no request-level dedup token, unlike Resend's
  `Idempotency-Key` header) is unchanged from the superseded ADR — the queue-level dedup on
  `notification_send_queue.idempotency_key` remains the real safety net. This ADR doesn't revisit that
  tradeoff, only removes the alternative that didn't have the gap.

## Alternatives considered

- **Keep Resend as a rollback path, gated by a flag** — rejected: with no live users and no volume
  to protect, a rollback path is speculative insurance against a problem that has no cost to
  re-solve later (Resend's adapter is in git history, not gone from the world). Maintaining a second
  provider's HTTP/retry/rate-limit code for that insurance is the more expensive default.
- **Wait until the AWS-side SES prerequisites are actually done before touching the code** — rejected:
  the code change and the AWS-side manual cutover are independent; sequencing the code first costs
  nothing (the app already degrades cleanly to `not_configured`) and avoids a second PR later.

## Consequences

`docs/engineering/resend-email-runbook.md` is renamed to `docs/engineering/ses-email-runbook.md` and
rewritten around SES; its provider-neutral content (hosted mailboxes for `aaron@`/`legal@dive.day`,
SPF/DKIM/DMARC guidance) carries over unchanged. Supersedes
[20260718-resend-transactional-email](20260718-resend-transactional-email.md),
[20260728-resend-delivery-controls](20260728-resend-delivery-controls.md), and
[20260802-ses-adapter-and-webhook](20260802-ses-adapter-and-webhook.md)'s opt-in-flag decision;
completes the AWS-side prep from
[20260802-ses-email-transition-prep](20260802-ses-email-transition-prep.md). Revisit adding a rate
limiter or a second provider only if SES's own throttling proves insufficient at real volume — not
before.
