# 20260802-sms-delivery-receipts-in-cloudformation — Switch SMS delivery-status logging on from the stack, not a runbook step

- **Status:** Accepted
- **Date:** 2026-08-02
- **Supersedes:** [20260802-sms-delivery-receipts](20260802-sms-delivery-receipts.md)

## Context

[20260802-sms-delivery-receipts](20260802-sms-delivery-receipts.md) built the SMS receipt pipeline —
CloudWatch Logs → subscription filter → forwarder Lambda → SNS topic → `/api/webhooks/sms` — and left
one piece to a human:

> **Switching delivery-status logging on stays a documented CLI step.** It is set by
> `sns set-sms-attributes`, which is account-level state with no CloudFormation resource. […]
> Inventing a custom resource to wrap one idempotent API call is more moving parts than the call.

The premise is correct and worth keeping straight, because it is easy to get wrong in both
directions. `AWS::SNS::Topic.DeliveryStatusLogging` does exist, but it covers only the
`http/s`, `sqs`, `lambda`, `firehose`, and `application` protocols and is scoped to a *topic* —
whereas a direct-to-phone-number `Publish` uses no topic at all and is configured by the
account-level `SetSMSAttributes` API. There is genuinely no native resource for this.

The conclusion drawn from that premise was wrong. "No native resource" is not "not expressible in
CloudFormation": `AwsCustomResource` exists precisely to close that gap, and it is one construct,
not hand-rolled infrastructure.

The cost argument was wrong too, and self-defeatingly so. "More moving parts than the call" was
written into a record that, three sections earlier, **adds a Lambda to this stack** for the
forwarder. The marginal operational surface of a second CDK-managed function is close to nothing
once the first one exists.

And the thing left manual is the worst possible candidate for it. The same ADR and runbook both say
that without this call SNS writes no receipts — so the topic, the filter, the forwarder, and the
webhook all sit idle *looking perfectly healthy*. It is the one step in the pipeline whose omission
nothing else can detect, which makes it the last thing that should depend on someone remembering.

## Decision

Everything in [20260802-sms-delivery-receipts](20260802-sms-delivery-receipts.md) carries over
unchanged — the four-hop pipeline, the extra SNS hop to reuse the SES webhook's verification, the
`SUCCESS` → `delivered` mapping, failure-only `providerResponse`, and two-week log retention. This
record changes exactly one thing:

- **`SetSMSAttributes` is called by an `AwsCustomResource` in the stack**, on create and on update,
  with the delivery-status role ARN and a 100% success sampling rate. Changing the role or the rate
  is a deploy, not a second thing to remember.

- **It sets only the two attributes it owns.** `SetSMSAttributes` merges rather than replaces, so
  this touches neither `MonthlySpendLimit` nor `DefaultSMSType` — an account-level API being
  configured from one stack has to be a narrow write, not a wholesale one.

- **On delete it clears `DeliveryStatusIAMRole`.** The role is stack-owned and goes with it, and an
  account left pointing at a deleted role logs nothing while still reading as configured — the same
  silent-idle failure this record exists to remove.

- **The IAM for the custom resource is two scoped statements**: `sns:SetSMSAttributes` on `*`
  (account-level state has no ARN to name) and `iam:PassRole` on that one role, because handing SNS
  a role to assume is a PassRole.

## Alternatives considered

- **Keep the CLI step** (the superseded decision). Rejected on the reasoning above: the argument
  against automating it was a cost that this stack had already paid, and the thing being left manual
  is the one whose omission is invisible.

- **Move sending to AWS End User Messaging**, whose configuration sets and event destinations are
  native CloudFormation resources, deleting this custom resource along with the Lambda and both log
  groups. Still the tidier destination and still rejected for the same reason the superseded record
  gave: it replaces the send path, not just the receipt path. This makes the interim cheaper to
  operate, which weakens rather than strengthens the case for rushing that migration.

- **A one-shot `cdk` script or a bootstrap task outside the stack.** Same forgettability as the CLI
  step, minus the discoverability of living next to the resources it configures.

## Consequences

- **A second Lambda in the stack**, CDK-managed, from `AwsCustomResource`'s own provider framework.
  This is the cost the superseded record declined to pay; it is smaller than that record assumed
  because the forwarder had already introduced the category.
- **Deploying the stack now changes account-level SNS state.** That is a wider blast radius than the
  rest of `infra/`, which only creates resources it owns — worth knowing before a deploy, and the
  reason the write is narrowed to two attributes and the delete is narrowed to one.
- **The runbook loses its most-likely-to-be-missed step.** Switching receipts on is now: deploy, set
  `SMS_SNS_TOPIC_ARN`, subscribe the endpoint.
- **Still unverified against real AWS.** The stack synthesizes and the template's `Custom::AWS`
  payload is correct by inspection, but nothing here has been deployed — the same caveat the
  superseded record carries, now covering one more resource.
