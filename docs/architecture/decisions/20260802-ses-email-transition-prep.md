# 20260802-ses-email-transition-prep — Provision dormant SES/SNS infra ahead of a possible Resend swap

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

[20260718-resend-transactional-email](20260718-resend-transactional-email.md) put Resend behind the
`notify()` seam in `src/lib/notifications/` specifically so the provider could be swapped later
without touching booking/waiver flows. Resend's free tier caps at 1,000 emails/month; that isn't a
real ceiling yet, but Aaron wants the AWS side of a future SES cutover ready in advance so the actual
swap — whenever volume warrants it — is a config change and one new adapter, not a scramble. This
record covers only the **dormant, AWS-side** preparation added now. It deliberately does not touch
`src/lib/notifications/`, does not add an AWS SDK runtime dependency, and does not change what
provider the app actually sends through — Resend remains live.

## Decision

Add to `infra/lib/infra-stack.ts`, all inert until the app is reconfigured to use them:

- **`ses.EmailIdentity`** for a dedicated `sesEmailDomain` context value (default `ses.dive.day` — a
  subdomain distinct from Resend's `send.dive.day`, so the two providers' DKIM/SPF records and
  sending reputations never collide while both exist side by side). Easy DKIM (the default) is used;
  the three DKIM CNAME tokens are surfaced as a `SesDkimRecords` output for manual DNS entry, the same
  manual-DNS pattern already used for Resend's domain verification.
- **`ses.ConfigurationSet`** + **`ses.ConfigurationSetEventDestination`** publishing to a new SNS
  topic (`diveday-ses-email-events`) for `BOUNCE`, `COMPLAINT`, `DELIVERY`, `DELIVERY_DELAY`,
  `REJECT`, and `RENDERING_FAILURE` events — mirroring the event set the existing Resend webhook
  tracks. `OPEN`/`CLICK` are excluded, matching the same privacy stance already documented in
  `resend-email-runbook.md`. The topic has no subscriber yet; one is only needed once an SNS-based
  webhook endpoint (mirroring `/api/webhooks/resend`) exists in the app.
- **A dedicated `diveday-ses-sender` IAM user**, granted `ses:SendEmail`/`ses:SendRawEmail` scoped to
  exactly this email identity via `EmailIdentity.grantSendEmail`. Its access key is minted out-of-band
  (`aws iam create-access-key`, instructions in a `CfnOutput`) rather than via `CfnAccessKey`, so no
  secret ever lands in the template or stack outputs — the same pattern already used for the MCP
  read-only users.

## Alternatives considered

- **Do nothing until the cap is actually hit** — the simplest option, and still the right call for
  the application-side swap (writing the SES adapter, the SigV4/SDK decision, the SNS webhook
  handler). But the AWS-side identity verification and DKIM DNS propagation have their own lead time
  independent of code, so provisioning them now removes that wait from the critical path later.
- **Reuse `send.dive.day` for both providers** — rejected: DKIM selectors wouldn't collide, but a
  shared MAIL FROM/SPF setup across two providers on one subdomain is exactly the kind of deliverability
  footgun the original Resend ADR avoided by using a dedicated subdomain in the first place.
- **Also scaffold the SES adapter in `src/lib/notifications/` now** — deferred out of this change on
  purpose. That decision needs its own call on SigV4 signing (hand-rolled vs. an AWS SDK runtime
  dependency, which is its own ADR) and a new bounce/complaint webhook handler; bundling it here would
  make this record about two decisions instead of one.

## Consequences

Makes the eventual cutover cheaper: DNS/DKIM verification can complete on its own clock, ahead of any
code change. Commits us to nothing — Resend stays the active provider, `check:env` and
`src/lib/notifications/` are untouched, and these AWS resources cost nothing to sit idle. Revisit (or
finish this out) when Resend's monthly volume actually approaches 1,000 sends: at that point, write
the SES adapter behind `notify()`, decide the SigV4 approach, add an SNS-consuming webhook route, and
only then request SES production access (a manual AWS Support case CDK cannot automate) and subscribe
that webhook to `SesEventNotificationsTopicArn`.
