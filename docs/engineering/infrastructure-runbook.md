# Infrastructure Provisioning Runbook

How to provision and manage AWS infrastructure for DiveDay using the AWS CDK (Cloud Development Kit).

All infrastructure is defined as code under the [infra/](../../infra/) directory in TypeScript.

> [!TIP]
> Looking for the checklist rather than the reasoning? [manual-actions.md](manual-actions.md) is
> every step `cdk deploy` cannot perform, generated from the stack itself and printed as stack
> outputs after each deploy. This file explains *why* each one resists automation; that one tells
> you what to run and where the result goes.

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
- Read-only IAM users for an AWS MCP server (local dev and Claude Code's cloud environment), each
  carrying an explicit `Deny` on `secretsmanager:GetSecretValue` so "read-only" cannot be escalated
  into credential retrieval by whatever AWS adds to the managed `ReadOnlyAccess` policy next.
- Cost guardrails: an `AWS::Budgets::Budget` and AWS Cost Anomaly Detection — see [§6](#6-cost-guardrails) below.
- SES/SNS infra for the app's sole email provider — see [§7](#7-ses-email-provider-infra) below. The code path is live; the AWS-side production access and DKIM/MAIL FROM DNS records are still manual steps.
- A versioned, private, retained S3 bucket as the destination for scheduled database export bundles — see [§8](#8-backup-bucket) below.
- HTTPS subscriptions wiring both SNS topics to the app's webhook routes — see [§9](#9-webhook-subscriptions) below. Created on every deploy, no flag required.
- An access key for every one of its eight IAM users, delivered through one Secrets Manager secret
  holding a filled-in `.env.example` — see [§10](#10-the-credentials-secret) below.
- `ManualActions*` outputs listing every step CDK cannot or deliberately does not perform, printed
  after each deploy so the remainder is visible rather than remembered. Same content as
  [manual-actions.md](manual-actions.md), generated from the same registry.

---

## 1. AWS Credentials & Authentication

To provision or modify infrastructure, you must authenticate with AWS.

### Installing Prerequisites
Ensure the [AWS CLI](https://aws.amazon.com/cli/) is installed on your local machine.

Two credentials are in play and they are not interchangeable:

| | What it is | What it is for |
| --- | --- | --- |
| **Administrator profile** | An IAM identity that predates this stack, configured by hand | Bootstrapping the account, and reading the credentials secret ([§10](#10-the-credentials-secret)). Nothing else. |
| **`cdk-deployer`** | Created *by* this stack; holds `sts:AssumeRole` on the four bootstrap roles and nothing more | Every subsequent `pnpm infra:deploy`. It cannot read the credentials secret, deliberately — see [§10](#10-the-credentials-secret). |

### Option A: Local AWS Profile (Recommended)
```bash
aws configure --profile diveday-admin
```
Enter your Administrator Access Key ID, Secret Access Key, Default region name (e.g., `us-east-1`), and Default output format (`json`).

Once the stack has been deployed once, the `cdk-deployer` credentials arrive in the credentials
secret and belong in `.env.local`'s `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, which every
`pnpm infra:*` script loads through `dotenv -c`. Keep the admin profile for the two jobs in the table
above and use `AWS_PROFILE=diveday-admin` when you need it.

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
> `infra:deploy` is a plain `cdk deploy`, so CDK's default `--require-approval broadening` applies:
> a deploy that changes IAM — which is most of them here — stops and asks. That is worth keeping now
> that a deploy can also *rotate* credentials; read the diff it prints rather than reaching for
> `--require-approval never`.

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

A deploy prints two kinds of output, and the split is deliberate.

**Values you can act on** — names, ARNs, URLs, DNS records. `S3BucketName`, `S3WebsiteURL`,
`BackupBucketName`, `SesDkimRecords`, `SesMailFromRecords`, `SesEventNotificationsTopicArn`,
`SmsDeliveryReceiptsTopicArn`, `CredentialsSecretName`.

**The manual-action checklist** — `ManualActions1Prerequisites` through `ManualActions5Verification`,
the same content as [manual-actions.md](manual-actions.md).

**No output carries key material.** `cloudformation:DescribeStacks` resolves outputs to plaintext,
and both the `cdk-deployer` user and the two read-only MCP users hold that permission — so an output
is the one surface where a secret is genuinely exposed rather than merely referenced. Every access
key goes to [§10](#10-the-credentials-secret) instead; `infra/lib/manual-actions.test.ts` fails the
build if one ever appears in an output again.

> [!NOTE]
> The `IAMUserAccessKey` and `IAMUserSecretKey` outputs are gone. They published the `reg-suit-bot`
> secret access key in cleartext to anyone who could describe the stack, which — via
> `bucket.grantReadWrite`'s `s3:DeleteObject*` on an unversioned bucket — meant a credential labelled
> read-only could destroy every visual baseline. Take the same values from the credentials secret.

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

The Budgets half needs no account-level setup — unlike a CloudWatch billing alarm on
`EstimatedCharges`, it doesn't need the "Receive Billing Alerts" console toggle enabled first. **Cost
Anomaly Detection does**: it depends on Cost Explorer, which is a one-time console opt-in with no
API, and reports nothing until it has accumulated spend history. That is a prerequisite in
[manual-actions.md](manual-actions.md), not something the stack handles.

**What this account costs when idle:** one Secrets Manager secret, $0.40/month
([§10](#10-the-credentials-secret)). Everything else here is per-use or free at this volume. That is
the number the `monthlyBudgetLimit` default of `5` is set against — if you add secrets, move the
limit with them, or the 50% and 80% notifications start firing every month on fixed cost and the
guardrail becomes noise.

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
- A `diveday-ses-sender` IAM user, scoped to `ses:SendEmail`/`ses:SendRawEmail` on just this identity
  and its configuration set. Its access key is minted by the deploy and delivered in the credentials
  secret ([§10](#10-the-credentials-secret)) as `SES_AWS_ACCESS_KEY_ID` /
  `SES_AWS_SECRET_ACCESS_KEY` — never store it in the repo.

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
4. Copy the SES values out of the credentials secret into Vercel, and redeploy the app.

Why each one resists automation:

- **1 and 2 (DNS):** authoritative DNS for `dive.day` is **Vercel DNS, not Route53** — the domain is
  registered at Vercel and served by `ns1`/`ns2.vercel-dns.com`, so this stack has no hosted zone to
  write records into. Adding one would mean replicating the live mail records (Purelymail MX, DKIM,
  DMARC) and replacing Vercel's apex `ALIAS` with hardcoded anycast A records that Vercel owns and
  rotates — a standing outage risk in exchange for automating two records.
- **3 (production access):** a human-reviewed AWS Support case. No API.
- **4 (placing the values):** Vercel runs the app and CDK runs the infrastructure; neither deploy
  pipeline can write to the other, so the values cross by hand. *Minting* the key is no longer
  manual — see [§10](#10-the-credentials-secret) for why that changed.

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

The uploader's access key is minted by the deploy and delivered in the credentials secret
([§10](#10-the-credentials-secret)), in its "Not .env values" section — because no destination for it
exists yet. `src/app/api/cron/backup-export/` reads no AWS credential, the runtime feature seals its
own per-shop credentials, and `.env.example` has no entry for it: the choice of runner is still a
`TODO(owner)` in [backup-and-restore-runbook.md](backup-and-restore-runbook.md). Leave the key in the
secret until that is decided.

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

This is why `verify-webhook-subscriptions` is in [manual-actions.md](manual-actions.md). Check **both**
topics — an earlier version of the checklist named only the SES one, and told you a pending SMS
subscription was caused by a step that could not fix it:

```bash
aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn>
aws sns list-subscriptions-by-topic --topic-arn <SmsDeliveryReceiptsTopicArn>
```

`SubscriptionArn: PendingConfirmation` means the endpoint answered non-2xx — `SES_SNS_TOPIC_ARN` or
`SMS_SNS_TOPIC_ARN` is missing from the app. Set it, redeploy the app, confirm it stops 503ing:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://www.dive.day/api/webhooks/ses -d '{}'
```

then `aws sns unsubscribe --subscription-arn <pending-arn>` and redeploy the stack to re-issue the
handshake. Redeploying alone won't fix it — CloudFormation still believes the subscription exists.

---

## 10. The credentials secret

Every one of this stack's eight IAM users gets an access key minted by CloudFormation, and all eight
are delivered through **one** Secrets Manager secret, `diveday/env`, whose value is
[`.env.example`](../../.env.example) with the values filled in.

```bash
AWS_PROFILE=diveday-admin aws secretsmanager get-secret-value \
  --secret-id diveday/env --query SecretString --output text
```

Paste the result over `.env.local`, or into Vercel's *Import .env* box. The credentials that do not
belong in a dotenv file — the two read-only MCP users, the backup uploader — ride at the bottom in a
commented section, each under the destination it belongs to, so pasting the whole document stays
safe.

### Why the document is `.env.example`

Because the destination format should be the hand-off format. A bespoke JSON shape means transcribing
field by field and inventing a mapping from key names to variable names; `.env.example` already *is*
this project's registry of what gets configured. The document is generated from that file at synth
time, so:

- a variable renamed in `.env.example` renames itself in the secret on the next deploy;
- a value the stack claims to supply for a key `.env.example` no longer declares **fails the synth**
  rather than silently vanishing;
- a new `*_AWS_ACCESS_KEY_ID`-shaped variable added to `.env.example` and not filled by the stack
  fails `infra/lib/manual-actions.test.ts`.

### Why the keys are minted by CloudFormation now

The previous posture was that every user minted its key out of band, because "`CfnAccessKey` would
put the secret in the CloudFormation template and stack state". That reasoning was half right and the
half that was wrong mattered:

- **The template does not expose it.** `cloudformation:GetTemplate` returns the unresolved
  `Fn::GetAtt`, at both `Original` and `Processed` stages. What leaked the `reg-suit-bot` key was
  publishing it as a **`CfnOutput`**, which `DescribeStacks` resolves. Outputs were the hole.
- **Minting by hand didn't avoid the secret**, it moved it into a terminal scrollback, once. Lose it
  and the only recovery is minting another and re-pasting it everywhere.
- **Rotation only becomes real when it is a deploy.** `AWS::IAM::AccessKey` has a `Serial` that may
  only ever be incremented; incrementing it makes CloudFormation replace the key create-then-delete,
  so the user is transiently at IAM's two-key ceiling and never below one working key.

```bash
pnpm infra:deploy --context credentialSerial=2                         # rotate every key
pnpm infra:deploy --context credentialSerial:diveday-ses-sender=2      # rotate one
```

Serial is not persisted between deploys. Pass the same value on every subsequent deploy or the next
one rotates the key *back* — record the current value here when you change it. **Current serial: 1
for every identity.**

The trade accepted in exchange: removing a key's construct from the stack now *deletes that key*,
breaking anything still holding it, where a hand-minted key would have survived untouched. That is
the correct default — a credential this stack no longer describes should stop working — but it is a
sharp edge worth knowing before deleting a user.

### Why one secret and not eight

Secrets Manager bills $0.40 per secret per month. Eight would be $3.20 against the ~$5/month this
account is budgeted for ([ADR 20260802-aws-cost-guardrails](../architecture/decisions/20260802-aws-cost-guardrails.md)),
which would make the budget's 50% and 80% notifications fire every month on fixed cost. One secret is
$0.40 and rounds to nothing. What that costs is granularity: whoever can read it reads all of it, and
there is no per-credential read scope — a distinction that is theoretical on a single-operator
account, where the same person holds account admin either way.

### Who can read it

**Nobody this stack creates.** Not `cdk-deployer`, whose entire rationale is that a leaked deploy
credential reaches nothing but the bootstrap roles — granting it every credential in the account
would undo that in one line. The two read-only MCP users are *explicitly denied*
`secretsmanager:GetSecretValue` on every secret, because `ReadOnlyAccess` is AWS's policy to change
and a Deny always beats an Allow.

Read it with the administrator profile, or in the console signed in as the account owner. It is a
hand-off point for a human, so a human's credential is the one that opens it.

> [!NOTE]
> Nothing reads this secret at runtime. The app never calls Secrets Manager; it reads environment
> variables that a person put there. The IAM keys are the system of record and this is a copy of them
> for you to move — which is also why the secret carries `RemovalPolicy.DESTROY`: once the stack is
> gone its users and keys are gone too, and a retained document of dead credentials that still looks
> live is worse than no document. CloudFormation deletes secrets with `ForceDeleteWithoutRecovery`,
> so there is no 7–30 day window blocking a redeploy under the same name.
