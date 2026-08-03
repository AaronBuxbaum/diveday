# 20260802-ses-adapter-and-webhook — Write the SES adapter with the AWS SDK, and its SNS webhook

- **Status:** Superseded by [20260803-ses-sole-email-provider](20260803-ses-sole-email-provider.md)
- **Date:** 2026-08-02

> The SES adapter, its SNS webhook, and the SigV4/SDK/hand-rolled-verification reasoning below all
> still stand as written. What's superseded is narrower: the opt-in `EMAIL_PROVIDER=ses` flag and
> "defaults to Resend" design — SES is now the sole, unconditional provider and Resend has been
> removed entirely.

## Context

[20260802-ses-email-transition-prep](20260802-ses-email-transition-prep.md) provisioned dormant
AWS-side SES/SNS infrastructure and named two pieces of follow-up code explicitly out of scope:
writing the SES adapter behind `notify()` (deciding how requests get signed) and a webhook route
consuming `SesEventNotificationsTopicArn`. This record covers both, completing that ADR's plan.
Resend and Twilio (`20260718-resend-transactional-email`, `20260721-sms-whatsapp-notifications`) are
both fetch-based with no SDK, on the reasoning that a two-field authenticated POST doesn't need one.
SES breaks that pattern: its API requires AWS SigV4 request signing, a non-trivial HMAC-chain
algorithm over the full canonical request. Getting it wrong doesn't throw a clear error — it silently
fails auth in ways that are miserable to debug and, worse, easy to get subtly wrong in a way that
still signs *something* without actually being correct.

## Decision

- **Add `@aws-sdk/client-sesv2` as a new runtime dependency** — a deliberate exception to the
  no-SDK house style, justified specifically by signing complexity: AWS's own SDK is the
  correctly-tested implementation of SigV4, and hand-rolling it here trades a well-understood
  dependency for a homegrown crypto surface with no upside. The SDK's default retry strategy also
  replaces what Resend's adapter hand-rolls in `requestResend` (backoff on throttling/5xx) — SES
  needs no equivalent retry loop in `src/lib/notifications/index.ts`.
- **Dedicated, distinctly-named AWS credentials for the app**: `SES_AWS_ACCESS_KEY_ID` /
  `SES_AWS_SECRET_ACCESS_KEY` / `SES_AWS_REGION`, explicitly passed to the `SESv2Client` constructor
  rather than left to the SDK's default credential-provider chain. The repo already has
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for the `cdk-deployer` user and
  `REG_SUIT_AWS_ACCESS_KEY_ID`/`REG_SUIT_AWS_SECRET_ACCESS_KEY` for `reg-suit-bot` — this follows
  that same one-credential-pair-per-purpose convention. Relying on the default provider chain would
  mean the running web app's runtime picks up whatever `AWS_ACCESS_KEY_ID` happens to be set to,
  which in a deploy environment could be the CDK deployer's far more powerful credential; explicit
  credentials rule that out. Sending uses the scoped `diveday-ses-sender` IAM user's key
  (`infra/lib/infra-stack.ts`), which can only `ses:SendEmail`/`ses:SendRawEmail` on this one identity.
- **Provider selection stays explicit, defaulting to Resend.** `notificationProviderFromEnvironment`
  only considers SES when `EMAIL_PROVIDER=ses` is set; otherwise it behaves exactly as before. A
  cutover is a deliberate flag flip, never an accidental side effect of SES credentials existing in
  an environment (e.g., left over from testing).
- **The SES adapter accepts the same idempotency-key gap Resend doesn't have.** SESv2's `SendEmail`
  has no request-level dedup parameter; Resend's `Idempotency-Key` header (24h server-side dedup) has
  no SES equivalent. The queue-level protection already in place — `notification_send_queue`'s unique
  `idempotency_key` column preventing the same logical notification from being enqueued twice — still
  holds regardless of provider. What SES loses is the narrower safety net for a single request that
  times out on the client side after the provider actually processed it: Resend would return the same
  cached message id on the inevitable retry; SES would send a second, distinct email. This is a real,
  accepted gap for now (see Consequences) rather than a build-it-later omission.
- **A new `/api/webhooks/ses` route**, structurally mirroring `/api/webhooks/resend`
  (`src/app/api/webhooks/resend/route.ts`): fails closed (503 unconfigured, 400 unverified), 200 for
  anything verified but unhandled (SNS also retries non-2xx), and delivers into the same
  `applyProviderEmailEvent(db, {...})` as Resend — SES's `Bounce`/`Complaint`/`Delivery`/
  `DeliveryDelay`/`Reject`/`RenderingFailure` events translate onto the identical `ProviderEmailStatus`
  union, so the dashboard/issue-surfacing code downstream needs no changes at all to support a second
  provider.
- **SNS message verification is hand-rolled** (`src/lib/notifications/sns.ts`), because there is no
  official AWS SDK helper for verifying an inbound SNS HTTP(S) notification's signature — the SDK
  signs *outbound* AWS API calls, which is a different problem than verifying a message SNS sent
  *to* us. This is genuinely security-sensitive, hand-written code and gets a `security-reviewer` pass
  before merge: it fetches a certificate from the message's own `SigningCertURL` and verifies an
  RSA-SHA1 or RSA-SHA256 signature over a canonical string built from the message fields. Two
  guardrails matter most: (1) `SigningCertURL` (and, for a `SubscriptionConfirmation`, `SubscribeURL`)
  is validated against `^https://sns\.[a-zA-Z0-9-]+\.amazonaws\.com(\.cn)?/` before ever being fetched
  — an attacker-supplied cert URL must never be dereferenced, or this becomes an SSRF and a signature
  forgery in one; and (2) the route also checks the message's `TopicArn` against
  `SES_SNS_TOPIC_ARN` (the already-provisioned `SesEventNotificationsTopicArn`), so a validly-signed
  message from a *different, unrelated* SNS topic in the same AWS partition can't be replayed here.
  `SubscriptionConfirmation` messages are auto-confirmed (the route fetches `SubscribeURL`) only
  after signature verification passes — the one-time step of actually subscribing this endpoint to
  the topic still has to happen once DNS/production-access work is done and is not automated by CDK.

## Alternatives considered

- **Hand-roll SigV4 for the send path too** — rejected for the reason above: this is exactly the kind
  of security-adjacent, easy-to-get-subtly-wrong code the SDK exists to avoid writing.
  `@aws-sdk/client-sesv2` is the smaller, more auditable risk.
- **Use the SDK's default credential provider chain (env/instance profile)** — rejected: it would
  make the app's runtime send-path implicitly depend on whatever `AWS_ACCESS_KEY_ID` is ambiently set
  to, rather than the specific scoped sender credential. Explicit `credentials` on the client
  constructor removes that ambiguity entirely.
- **A verification library for SNS message signing** — no actively maintained, widely-used package
  exists for this exact purpose that matches the project's fetch-based/no-unnecessary-deps posture;
  the verification algorithm itself is short and fully specified by AWS's docs, so hand-rolling it
  with thorough adversarial tests is more auditable than trusting an obscure dependency's maintenance.
- **Block on fixing the idempotency gap before writing the adapter** — rejected: the gap is real but
  narrow (a client-side timeout racing a server-side success), the app-level queue dedup already
  covers the common case, and this code stays dormant (gated behind `EMAIL_PROVIDER=ses`) until an
  operator deliberately flips it on. Documenting the gap here is the fix for now; closing it (e.g., a
  dedup table keyed on idempotency key + provider, checked before a send) is real work that belongs
  to the actual cutover, not to writing the dormant adapter.

## Consequences

Resend stays the sole live provider; nothing here changes production behavior until
`EMAIL_PROVIDER=ses` is set deliberately, and that in turn needs the SES production-access request
and DNS/DKIM verification `20260802-ses-email-transition-prep` already named as manual prerequisites.
Adds one new runtime dependency (`@aws-sdk/client-sesv2`) and one new hand-rolled security-sensitive
module (SNS verification) that must be kept in mind on any future audit of this codebase's crypto
surface. Revisit before actually cutting SES live for any high-volume or retry-heavy flow: close the
idempotency gap above, and mint the `diveday-ses-sender` access key and `SES_SNS_TOPIC_ARN` value
into the deploy environment (never the repo).
