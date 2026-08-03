# Infrastructure Provisioning Runbook

How to provision and manage AWS infrastructure for DiveDay using the AWS CDK (Cloud Development Kit).

All infrastructure is defined as code under the [infra/](../../infra/) directory in TypeScript.

---

## Overview

We use AWS CDK to model, deploy, and update our cloud resources. Currently, the infrastructure consists of the `DiveDay` stack, which provisions:
- An S3 bucket for storing visual regression testing (VRT) baselines and HTML reports.
- A `reg-suit-bot` IAM user with specific S3 read/write permissions.
- A dedicated `cdk-deployer` IAM user that holds **no direct AWS permissions of its own** — only
  `sts:AssumeRole` on the four `cdk bootstrap` roles (deploy / file-publishing / image-publishing /
  lookup) plus read access to stack status and the bootstrap version parameter. Deliberately *not*
  `AdministratorAccess`: the bootstrap roles are already scoped to what CDK deploys need, so a
  leaked deployer credential stays bounded by them. The stack comments at
  [infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts) §5 carry the full reasoning.
- Read-only IAM users for the AWS MCP server (local dev and Claude Code's cloud environment).
- Cost guardrails: an `AWS::Budgets::Budget` and AWS Cost Anomaly Detection — see [§6](#6-cost-guardrails) below.
- SES/SNS infra for the app's sole email provider — see [§7](#7-ses-email-provider-infra) below. The code path is live; the AWS-side production access, DKIM/MAIL FROM DNS records, and credentials are still manual steps.
- A versioned, private, retained S3 bucket as the destination for scheduled database export bundles — see [§8](#8-backup-bucket) below.
- HTTPS subscriptions wiring both SNS topics to the app's webhook routes — see [§9](#9-webhook-subscriptions) below. Created on every deploy, no flag required.
- A `ManualActionItems` output listing every step CDK structurally cannot perform, printed after each deploy so the remainder is visible rather than remembered.

---

## 1. AWS Credentials & Authentication

To provision or modify infrastructure, you must authenticate with AWS.

### Installing Prerequisites
Ensure the [AWS CLI](https://aws.amazon.com/cli/) is installed on your local machine.

### Option A: Local AWS Profile (Recommended for first-time setup)
If bootstrapping the account for the first time, configure your credentials using the CLI:
```bash
aws configure
```
Enter your Administrator Access Key ID, Secret Access Key, Default region name (e.g., `us-east-1`), and Default output format (`json`).

### Option B: Session Environment Variables
Alternatively, you can export credentials in your current terminal session:
```bash
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_DEFAULT_REGION="us-east-1"
```

---

## 2. Bootstrapping the Environment

AWS CDK requires one-time bootstrapping of an AWS environment (combination of account and region) before you can deploy any stacks. This process provisions resources CDK needs to operate (like an S3 bucket for staging assets).

To bootstrap the default account/region:
```bash
pnpm infra:bootstrap
```

> [!NOTE]
> If your environment requires an explicit account pin, set the `AWS_ACCOUNT_ID` environment variable:
> `AWS_ACCOUNT_ID=123456789012 pnpm infra:bootstrap`

---

## 3. Managing and Deploying Stacks

Once bootstrapped, you can use the package scripts to synthesize, inspect, and deploy your CDK stacks.

### Synthesizing CloudFormation Templates
To translate your TypeScript CDK definitions into raw AWS CloudFormation templates:
```bash
pnpm infra:synth
```

### Comparing Changes (Diff)
Before deploying, always run a diff to preview how your changes will affect the active environment:
```bash
pnpm infra:diff
```

### Deploying Stacks
To deploy the stack to AWS:
```bash
pnpm infra:deploy
```

> [!IMPORTANT]
> The `infra:deploy` script is configured with `--require-approval never` to execute non-interactively. Ensure you have run `pnpm infra:diff` to inspect changes beforehand.

---

## 4. Context Variables & Custom Configuration

You can customize stack properties dynamically during synthesis and deployment using CDK Context.

In our stack:
- `bucketName`: Sets the custom name for the created S3 bucket (default: `diveday-vrt`).
- `userName`: Sets the name for the IAM bot user (default: `reg-suit-bot`).
- `alertEmail` / `monthlyBudgetLimit`: cost guardrails — [§6](#6-cost-guardrails).
- `sesEmailDomain` / `sesMailFromDomain`: SES sending identity and envelope domain — [§7](#7-ses-email-provider-infra).
- `webhookHost`: the app origin whose webhook routes get subscribed to both SNS topics (default: `https://www.dive.day`) — [§9](#9-webhook-subscriptions).
- `backupBucketName`: destination for export bundles — [§8](#8-backup-bucket).

Pass these values during deployment or synthesis using the `--context` flag:
```bash
pnpm infra:deploy --context bucketName=my-custom-prod-bucket --context userName=my-custom-bot-user
```

---

## 5. Outputs and Environment Configuration

Upon successful deployment, the CDK CLI outputs key resources and credentials. Map these to your `.env.local` to allow the application or CI runner to communicate with AWS:

- **CDK Deployer User (`cdk-deployer`):** mint its access key out of band with the command the
  `CdkDeployerAccessKeyInstructions` output prints (`aws iam create-access-key --user-name
  cdk-deployer`) and use it for subsequent CI/CD deployments instead of root credentials. No secret
  for this user is emitted as a stack output, so nothing lands in the CloudFormation template or
  state.
- **S3 Bucket Details:** Use `S3BucketName` and `IAMUserAccessKey` / `IAMUserSecretKey` for S3 upload plugins.
- **Backup Bucket:** `BackupBucketName` and the `BackupUploaderAccessKeyInstructions` command — see [§8](#8-backup-bucket).

---

## 6. Cost guardrails

The stack provisions two **alert-only** mechanisms — see
[ADR 20260802-aws-cost-guardrails](../architecture/decisions/20260802-aws-cost-guardrails.md) for
the full reasoning. Neither one ever disables or throttles a resource; both only send email.

- **`AWS::Budgets::Budget`** (`diveday-monthly-cost-guardrail`) — a monthly `COST` budget, default
  $5, with five graduated email notifications: 50% and 80% of actual spend, 100% of *forecasted*
  spend (an early warning before the month even ends), 100% of actual spend, and 200% of actual
  spend as the "this is outside normal bands" siren.
- **AWS Cost Anomaly Detection** (`diveday-service-cost-anomalies` monitor +
  `diveday-service-cost-anomaly-alerts` subscription) — an AWS-managed, ML-based monitor over
  per-service spend, checked daily, that emails when any single service's cost moves in an
  unexpected way (rate of increase, not just an absolute dollar threshold) with at least $1 of
  impact. This is what catches "spend is accelerating" even while comfortably under the budget cap
  above.

Both use CDK context values, overridable the same way as `bucketName`/`userName`:

```bash
pnpm infra:deploy --context alertEmail=you@example.com --context monthlyBudgetLimit=10
```

- `alertEmail` — where every alert goes (default `aaronbuxbaum@gmail.com`).
- `monthlyBudgetLimit` — the monthly USD cap the percentage thresholds above are computed against
  (default `5`).

No manual account-level setup is required — unlike a CloudWatch billing alarm on
`EstimatedCharges`, Budgets and Cost Anomaly Detection don't need the "Receive Billing Alerts"
console toggle enabled first.

---

## 7. SES email-provider infra

SES is the app's sole email provider in code (ADR
[20260803-ses-sole-email-provider](../architecture/decisions/20260803-ses-sole-email-provider.md),
superseding [20260802-ses-adapter-and-webhook](../architecture/decisions/20260802-ses-adapter-and-webhook.md)'s
opt-in flag and [20260802-ses-email-transition-prep](../architecture/decisions/20260802-ses-email-transition-prep.md)'s
original "prep ahead of a possible Resend swap" framing — Resend has been removed entirely). The
AWS-side infra below is still a manual multi-step cutover before real sending works; this section is
the "how to actually use it" reference. See [docs/engineering/ses-email-runbook.md](ses-email-runbook.md)
for the day-to-day operational guide.

**What's provisioned now (AWS side):**
- An `ses.EmailIdentity` for `sesEmailDomain` (context value, default `ses.dive.day`).
- Easy DKIM signing (SES's default) — the `SesDkimRecords` output has the three CNAME records to add
  to DNS.
- A custom MAIL FROM domain, `sesMailFromDomain` (context value, default `mail.ses.dive.day`) —
  the envelope sender, which AWS requires be a *different* subdomain from the one you send from.
  The `SesMailFromRecords` output has the MX and TXT records to add. `BehaviorOnMxFailure` is
  `USE_DEFAULT_VALUE`, so a missing record costs SPF alignment rather than the send. See
  [the runbook](ses-email-runbook.md#the-custom-mail-from-domain).
- An `ses.ConfigurationSet` (with `optimizedSharedDelivery` enabled, `engagementMetrics` deliberately
  left off — see the no-opens/no-clicks privacy stance in the runbook) wired to a new SNS topic
  (`SesEventNotificationsTopicArn` output) for bounce/complaint/delivery events.
- A `diveday-ses-sender` IAM user, scoped to `ses:SendEmail`/`ses:SendRawEmail` on just this identity.
  Mint its access key only once cutover actually begins:
  ```bash
  aws iam create-access-key --user-name diveday-ses-sender
  ```
  (the exact command is also in the `SesSenderAccessKeyInstructions` output) — never store the result
  in the repo.

**What's written now (app side):** an SES adapter (`sesNotificationProvider` /
`notificationProviderFromEnvironment` in `src/lib/notifications/index.ts`, using
`@aws-sdk/client-sesv2`) and `/api/webhooks/ses` (verifying SNS message signatures by hand in
`src/lib/notifications/sns.ts`, translating SES events in `src/lib/notifications/ses-events.ts`).
The code path is live and unconditional; it just has nothing to send through until the AWS-side steps
below are done — until then, missing/invalid credentials mean every send resolves to
`not_configured`. Relevant env vars:

| Variable | Purpose |
| --- | --- |
| `SES_AWS_REGION` / `SES_AWS_ACCESS_KEY_ID` / `SES_AWS_SECRET_ACCESS_KEY` | The `diveday-ses-sender` IAM user's own credentials — never the `cdk-deployer` or `reg-suit-bot` ones. |
| `SES_FROM_EMAIL` | The sender address on `sesEmailDomain`. |
| `SES_SNS_TOPIC_ARN` | `SesEventNotificationsTopicArn`'s value — `/api/webhooks/ses` answers 503 without it, and rejects a correctly-signed message from any other topic. |

**What's still manual before real sending works** — each for a reason the stack can't remove:
1. Add the `SesDkimRecords` CNAME records to `ses.dive.day`'s DNS and wait for verification.
2. Add the `SesMailFromRecords` MX and TXT records to `mail.ses.dive.day`. **Exactly one MX
   record** — SES fails the MAIL FROM setup outright if the subdomain has several.
3. Request SES **production access** (an AWS Support case — CDK cannot do this) once ready to send
   beyond the sandbox's verified-recipients-only limit.
4. Mint the `diveday-ses-sender` access key and set the env vars above in the real deploy
   environment (never the repo).

Why each one resists automation:

- **1 and 2 (DNS):** authoritative DNS for `dive.day` is **Vercel DNS, not Route53** — the domain is
  registered at Vercel and served by `ns1`/`ns2.vercel-dns.com`, so this stack has no hosted zone to
  write records into. Adding one would mean replicating the live mail records (Purelymail MX, DKIM,
  DMARC) and replacing Vercel's apex `ALIAS` with hardcoded anycast A records that Vercel owns and
  rotates — a standing outage risk in exchange for automating two records.
- **3 (production access):** a human-reviewed AWS Support case. No API.
- **4 (credentials):** deliberate. `CfnAccessKey` would put the secret in the CloudFormation
  template and stack state; every IAM user in this stack mints its key out of band for that reason.
  The env vars then live in Vercel, a different platform from the one CDK manages.

**Subscribing the webhooks is no longer on this list** — see
[§9](#9-webhook-subscriptions) below.

Override either domain the same way as other context values:
```bash
pnpm infra:deploy --context sesEmailDomain=ses.example.com --context sesMailFromDomain=mail.ses.example.com
```

---

## 8. Backup bucket

`DatabaseBackupBucket` (§11 in the stack file) is the destination for the scheduled logical export of
production data. See
[ADR 20260802-backup-and-restore-posture](../architecture/decisions/20260802-backup-and-restore-posture.md)
for why it exists and
[backup-and-restore-runbook.md](backup-and-restore-runbook.md) for how it is written to and restored
from. This section is the infrastructure reference only.

**It is a separate bucket from `VisualRegressionBucket`, and must stay one.** That bucket is
`publicReadAccess: true`, `RemovalPolicy.DESTROY`, and expires objects after 7 days — every single
property is wrong for a backup. Do not consolidate them.

| Property | Value | Why |
| --- | --- | --- |
| Name | `backupBucketName` context value, default `diveday-backups` | Same override pattern as `bucketName`/`userName` |
| Versioning | On | An overwrite by a bad export never destroys the good one underneath |
| Public access | `BlockPublicAccess.BLOCK_ALL` | Bundles contain waiver and medical records |
| Encryption | SSE-S3, plus `enforceSSL` (a bucket policy denying non-TLS requests) | At rest and in transit |
| Removal policy | `RETAIN` | The one resource in this stack that must survive `cdk destroy`. Deleting production backups should require a deliberate manual act |
| Lifecycle | Infrequent Access at 30 days; Glacier **Instant** Retrieval at 90; non-current versions expire at 90 days; incomplete multipart uploads abort at 7 days. **Current versions never expire.** | Cost is managed by getting colder, not by deleting. Waiver retention is "indefinite" pending [H-02](../product/human-decisions.md), so a lifecycle rule must never be what decides evidence has outlived its usefulness. Glacier *Instant*, not Flexible or Deep, because a restore happens during an incident and a multi-hour thaw would make the backup useless exactly when it is needed |
| Uploader | IAM user `diveday-backup-uploader`, `s3:PutObject` + `s3:AbortMultipartUpload` on `arnForObjects("*")` and nothing else | Write-only, same least-privilege posture as `cdk-deployer` in §5. A leaked uploader credential can neither read a shop's exported waivers back out nor destroy an existing backup |

Mint the uploader's key only when wiring up whatever runs the export, and store it in that runner's
secret settings — never the repo:

```bash
aws iam create-access-key --user-name diveday-backup-uploader
```

Override the bucket name the same way as other context values:
```bash
pnpm infra:deploy --context backupBucketName=my-backup-bucket
```

> [!IMPORTANT]
> Because of `RemovalPolicy.RETAIN`, a `cdk destroy` leaves this bucket (and its contents) behind and
> a later `cdk deploy` will fail if it tries to re-create a bucket whose name is already taken. That
> is the intended trade: re-adopt the existing bucket by name rather than deleting it to make a
> deploy go green.

---

## 9. Webhook subscriptions

Two SNS topics carry delivery outcomes into the app, and the stack subscribes both — see
[ADR 20260803-webhook-subscriptions-in-cdk](../architecture/decisions/20260803-webhook-subscriptions-in-cdk.md)
for why this moved out of the runbooks. An unsubscribed topic is the failure nothing detects: every
hop either side of it reads healthy while no event ever arrives.

| Topic | Endpoint | Without it |
| --- | --- | --- |
| `diveday-ses-email-events` | `/api/webhooks/ses` | a bounced booking confirmation stays invisible |
| `diveday-sms-delivery-receipts` | `/api/webhooks/sms` | an undelivered SMS reads as sent |

Both are created on every deploy. Nothing to pass and nothing to remember — `webhookHost` defaults
to `https://www.dive.day` and only needs overriding for a preview or self-hosted origin:

```bash
pnpm infra:deploy --context webhookHost=https://staging.example.com
```

Use the **canonical** origin — `dive.day` 308-redirects to `www.dive.day`, and a redirect is not a
confirmation. Changing `webhookHost` later replaces the subscription rather than updating it
(`Endpoint` is replacement-on-update), so expect a fresh handshake and a brief window where events
are dropped.

### When a subscription won't confirm

A subscription is only real once the endpoint answers SNS's handshake, and both routes return `503`
until their `SES_SNS_TOPIC_ARN` / `SMS_SNS_TOPIC_ARN` env var is set. On a fresh environment the
stack therefore creates a subscription the app cannot yet confirm; SNS deletes it after ~3 days.

This is item 5 of the `ManualActionItems` output for that reason. To check:

```bash
aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn>
```

`SubscriptionArn: PendingConfirmation` means the endpoint answered non-2xx. Set the env vars,
redeploy the app, confirm it stops 503ing:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://www.dive.day/api/webhooks/ses -d '{}'
```

then `aws sns unsubscribe --subscription-arn <pending-arn>` and redeploy the stack to re-issue the
handshake. Redeploying alone won't fix it — CloudFormation still believes the subscription exists.
