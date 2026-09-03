# 20260903-ses-lives-in-its-own-region — Send mail from us-east-2, in a second CDK stack

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

AWS refused DiveDay's SES production-access request in us-east-1 with its standard no-reason "this
decision is final" wording. [20260902-sender-standards-for-ses](20260902-sender-standards-for-ses.md)
closed the four gaps a reviewer's checklist reads for, and
[docs/engineering/ses-email-runbook.md](../../engineering/ses-email-runbook.md) carries a case text
written to be ticked row by row. What it cannot do is make the next reviewer a different person in
the same queue, days after the last one, holding the closed case.

The SES sandbox is **per region**. A refusal in one carries no weight in another, and the runbook has
always named a second region as the third thing to try. So the request goes to us-east-2, and the
identity has to be there for it — which means moving resources, because SES is regional and so is
CloudFormation. Nothing else in the stack needs to move: the buckets, the log group, the RUM monitor,
the CloudFront distribution and every IAM identity are either fine where they are or global.

The intent is to come back. us-east-1 is where the rest of the app is, and once there is some
distance from the refusal it is the region to re-request in. So this change is written to be
undone by one constant, not by a second migration.

## Decision

- **`config/aws-regions.mjs` is the one place a region or a stack name is written down.** `SES_REGION`
  is `us-east-2` today; `infra/lib/stack-config.ts` re-exports it for the CDK app and
  `scripts/infra-bootstrap.mjs`, `scripts/infra-deploy.mjs` and `scripts/post-deploy-wizard.mjs`
  import it directly. Moving back to us-east-1 is that one line plus the DNS and the new request.
- **A second stack, `DiveDayEmail` (`diveday-email`), pinned to `SES_REGION`**
  (`infra/lib/email-stack.ts`). It holds everything CloudFormation can only create in the sending
  region: the verified identity, the configuration set and its event destination, the SNS topic
  `/api/webhooks/ses` is subscribed to, and the two `AWS/SES` reputation alarms with the topic they
  notify. Account-agnostic and region-specific, so `cdk synth` still runs with no credentials.
- **The `diveday-ses-sender` IAM user stays in the main stack.** IAM is global and its access key
  belongs in the one credentials document (S16). Its policy names the identity and configuration-set
  ARNs *in `SES_REGION`*, built from the shared constants rather than from the constructs.
- **The two stacks share no synth-time reference.** No `crossRegionReferences`, so no SSM shuttle
  near a credential and no fixed deploy order. `SES_SNS_TOPIC_ARN` in the hand-off document is
  assembled from `SES_REGION` plus the topic name, exactly as the email stack will name it.
- **A deploy is both stacks.** `pnpm infra:deploy` adds `--all` when no stack is named, CI names both,
  and `pnpm infra:bootstrap` bootstraps both regions. The deployer user and both CI roles hold the
  bootstrap-role, `cloudformation` and bootstrap-version-parameter grants in both regions, the CI
  ones still scoped to these two stacks by name rather than to `stack/*/*`.
- **Deploying the main stack alone is what removes SES from us-east-1.** The template stops
  describing the identity, configuration set, event destination, topic and alarms, so CloudFormation
  deletes them. There is no separate teardown step and no retained resource.

## Alternatives considered

- **Move the whole stack to us-east-2** — every bucket, the log group, the RUM monitor and the
  CloudFront distribution would be recreated, and the visual-regression baselines and backup buckets
  are not things to move to win an argument with a support reviewer.
- **One stack with `crossRegionReferences: true`** — CDK gets values across a region border by
  writing them into SSM parameters read by a custom resource. That is a poor place for anything
  adjacent to a sending credential, and it makes the two halves deploy in a fixed order for a joint
  that two shared string constants make for free.
- **Custom resources calling the SES API in another region from the us-east-1 stack** — an
  `AwsCustomResource` per SES resource, hand-written create/update/delete, no drift detection, and
  the DKIM tokens read back through a Lambda. All of the cost of a second stack and none of
  CloudFormation.
- **Ask again in us-east-1 and wait** — still the plan, later. It is the reason `SES_REGION` is one
  constant rather than a hundred edits.

## Consequences

- **Two alarm topics, so two confirmation clicks.** A CloudWatch alarm can only notify an SNS topic
  in its own region, so the SES reputation alarms have their own `diveday-ses-alarms` beside the
  main stack's `diveday-observability-alarms`. Manual action `confirm-observability-alarms` now says
  twice.
- **The DNS is region-specific and does not follow the constant.** SES mints different DKIM tokens
  per region, and the MAIL FROM MX names the region. Both are re-added by hand from the new stack's
  outputs on every move (`ses-dkim-dns`, `ses-mail-from-dns`), and the MX is a delete-then-add — SES
  refuses the setup outright if the subdomain carries more than one.
- **Mail is refused, briefly, in the window between the two deploys.** The credential names a region
  whose identity does not exist yet, so a send answers `MessageRejected` and the app's own retry
  handles it once the other stack lands. Either order works.
- **`--parameters` now needs a stack named.** Unqualified, it is applied to every stack in the
  deploy, and the email stack declares none — so `pnpm infra:deploy DiveDay --parameters
  CredentialSerial=<n>` is the rotation command, and the wrapper refuses the unqualified form rather
  than half-doing it.
- **Production access is per region, and this is a fresh request.** us-east-2 starts in the sandbox:
  pre-verified addresses and the mailbox simulator only, and no `Reputation.*` metrics at all until
  it is granted, so the two alarms sit at their `notBreaching` default meanwhile.

Revisit when the us-east-2 request is granted and has run long enough to be worth trading for
proximity, or when it is refused too — at which point the answer is a support plan, not a third
region. Coming back is `SES_REGION = "us-east-1"`, a deploy, the DKIM and MAIL FROM records again,
and one more case.
