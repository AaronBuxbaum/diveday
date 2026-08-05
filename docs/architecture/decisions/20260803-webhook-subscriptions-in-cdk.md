# 20260803-webhook-subscriptions-in-cdk — Subscribe the app's webhooks to their SNS topics from the stack

- **Status:** Accepted
- **Date:** 2026-08-03

> [!NOTE]
> The decision stands; one name in it has moved. The single `ManualActionItems` output this record
> describes was replaced by the per-category `ManualActions*` outputs and the generated
> [manual-actions.md](../../engineering/manual-actions.md) in
> [20260805-cdk-minted-credentials-and-manual-actions](20260805-cdk-minted-credentials-and-manual-actions.md).
> The subscription check is still printed on every deploy; it is the `verify-webhook-subscriptions`
> entry rather than "item 5".

## Context

Two SNS topics in `infra/lib/infra-stack.ts` carried delivery outcomes that nothing was subscribed
to:

- `diveday-ses-email-events` (§8) — SES bounce, complaint, delivery, and rejection events
- `diveday-sms-delivery-receipts` (§10) — the SMS receipt pipeline's final hop

Both runbooks ended with the same instruction: go create an HTTPS subscription by hand, in the
console or with `aws sns subscribe`. Both routes already auto-confirm the SNS handshake after
verifying the message signature, so the manual part was only ever *pointing SNS at the URL*.

This is the identical failure shape that
[20260802-sms-delivery-receipts-in-cloudformation](20260802-sms-delivery-receipts-in-cloudformation.md)
was written to remove one step earlier in the same pipeline. Its argument applies here without
modification: **an unsubscribed topic is the failure nothing detects.** The identity verifies, the
configuration set publishes, the topic exists, the Lambda forwards, the route answers — every hop
reads healthy, and no event ever arrives. Nothing in the product degrades visibly; a shop simply
never learns that a booking confirmation bounced.

That record also established the precedent that "this is a small manual step" is not a reason to
leave it manual once the stack already manages the resources either side of it.

## Decision

**Both subscriptions are created by the stack, unconditionally**, via `UrlSubscription` from
`aws-cdk-lib/aws-sns-subscriptions`, with the protocol derived from the `https://` URL.

**`webhookHost` is a context value with a real default** (`https://www.dive.day`), not an opt-in
flag. A plain `pnpm infra:deploy` wires both webhooks. This is the part that matters: a *conditional*
subscription is worse than no automation at all, because once a flagged deploy creates it, the next
unflagged `cdk deploy` drops the resource from the template and **CloudFormation deletes it** —
restoring the exact silent gap this record exists to close, at the moment nobody is looking for it.
An operator has to remember a flag forever, and forgetting it is destructive rather than merely
inert.

**One context value drives both**, because both routes are served by the same deployment. Two
separate values would be two things to keep in step for no gain.

**It must be the canonical origin.** `dive.day` 308-redirects to `www.dive.day`, and a redirect is
not a confirmation.

**The ordering hazard is surfaced, not prevented.** An HTTPS subscription is only real once the
endpoint confirms the handshake, and both routes answer `503` until their `SES_SNS_TOPIC_ARN` /
`SMS_SNS_TOPIC_ARN` env var is set — so a subscription created before the app is configured sits
`PendingConfirmation` and is deleted by SNS after roughly three days. Rather than gate on it, the
stack emits a `ManualActionItems` output after every deploy whose last item is the check that
catches this:

```bash
aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn>
```

A `SubscriptionArn` of `PendingConfirmation` means the endpoint answered non-2xx. Fix the cause,
unsubscribe, and redeploy to re-issue the handshake.

That output is the general answer to "what is left": every step this stack structurally cannot
perform — DNS at Vercel, the production-access support case, out-of-band credential minting, the
Vercel env vars — is printed as a numbered checklist on every deploy, so the remainder is visible
rather than remembered.

## Alternatives considered

- **Keep both as runbook steps.** Rejected on the reasoning above, and for consistency: the SMS
  pipeline's *other* invisible step was moved into the stack a day earlier, so leaving its final hop
  manual is an inconsistency rather than a decision.

- **Gate the subscriptions behind an opt-in `webhookHost` flag, unset by default.** Rejected, and
  worth recording because it was the initial design. The stated benefit was avoiding a subscription
  that cannot confirm on a fresh account. The cost is far larger and asymmetric: CloudFormation
  reconciles to the template, so the *absence* of the flag on any later deploy deletes a working
  subscription. That converts "forgot a flag" from a no-op into an outage in the one signal path
  nothing else monitors. A hazard that appears once at bootstrap does not justify a footgun that
  stays armed on every subsequent deploy — especially when the bootstrap case is detectable, and now
  printed as item 5 of `ManualActionItems`.

- **An `AwsCustomResource` wrapping `sns subscribe`.** Pointless here: unlike `SetSMSAttributes` in
  the prior ADR, `AWS::SNS::Subscription` is a native CloudFormation resource.

- **Read the host from an environment variable rather than context.** Rejected for consistency —
  every other operator-supplied input to this stack (`alertEmail`, `sesEmailDomain`,
  `monthlyBudgetLimit`, `bucketName`) is a context value.

## Consequences

- **Two manual steps disappear** from
  [ses-email-runbook.md](../../engineering/ses-email-runbook.md) and
  [sms-delivery-receipts-runbook.md](../../engineering/sms-delivery-receipts-runbook.md).

- **A bootstrap ordering exists**: on a fresh environment, the subscription is created before the
  app can confirm it, and expires after ~3 days. This is accepted rather than prevented — the
  recovery is to set the env vars, unsubscribe, and redeploy, and `ManualActionItems` item 5 names
  the check. On an environment where the app is already serving with its env vars set, redeploys
  are uneventful.

- **The stack now depends on a URL owned by a different deploy pipeline.** Vercel serves the app;
  CDK serves the infrastructure. `webhookHost` makes the coupling explicit and overridable, but it
  is a real coupling: a preview or self-hosted deployment must pass its own origin.

- **Every deploy prints a checklist.** `ManualActionItems` lists the steps CDK structurally cannot
  perform. It is a stack output rather than a doc link so it cannot drift out of sight, and the
  runbook carries the reasoning for why each item resists automation.

- **Rotating the app's origin means redeploying the stack.** `Endpoint` is replacement-on-update, so
  a changed `webhookHost` destroys and recreates the subscription — which means a fresh confirmation
  handshake, and a short window where events are dropped.

- **Still unverified against real AWS.** The stack synthesizes and both conditional paths were
  checked (zero `AWS::SNS::Subscription` resources without the flag, two with it), but no deploy has
  exercised the confirmation handshake — the same caveat the prior two SES/SMS records carry.
