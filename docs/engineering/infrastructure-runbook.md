# Infrastructure Provisioning Runbook

How to provision and manage AWS infrastructure for DiveDay using the AWS CDK (Cloud Development Kit).

All infrastructure is defined as code under the [infra/](../../infra/) directory in TypeScript.

> [!TIP]
> `pnpm infra:deploy` is the guided path: it creates the env files, then asks whether to update
> Vercel, GitHub, and SES DNS. [manual-actions.md](manual-actions.md) is intentionally short: only
> account approvals that no CLI can perform remain there.
> Before CDK runs, the wrappers verify their selected AWS CLI profile and open `aws login` when the
> console session is absent or expired.

---

## Overview

We use AWS CDK to model, deploy, and update our cloud resources. Currently, the infrastructure consists of the `DiveDay` stack, which provisions:
- An S3 bucket for storing visual regression testing (VRT) baselines and HTML reports.
- A `reg-suit-bot` IAM user with specific S3 read/write permissions.
- A dedicated `cdk-deployer` IAM user that holds **no direct AWS permissions of its own** — only
  `sts:AssumeRole` on the four `cdk bootstrap` roles (deploy / file-publishing / image-publishing /
  lookup) plus read access to stack status and the bootstrap version parameter. Better than handing
  out `AdministratorAccess` directly — the credential is useless outside CloudFormation and revoking
  it is one `DeleteAccessKey` — but **not a privilege boundary**: the deploy role passes an execution
  role that a plain `cdk bootstrap` leaves at `AdministratorAccess`. See
  [who can read it](#who-can-read-it). The stack comments at
  [infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts) §5 carry the full reasoning.
- Read-only IAM users for an AWS MCP server (local dev and Claude Code's cloud environment), each
  carrying an explicit `Deny` on `secretsmanager:GetSecretValue` so "read-only" cannot be escalated
  into credential retrieval by whatever AWS adds to the managed `ReadOnlyAccess` policy next.
- Cost guardrails: an `AWS::Budgets::Budget` and AWS Cost Anomaly Detection — see [§6](#6-cost-guardrails) below.
- SES/SNS infra for the app's sole email provider — see [§7](#7-ses-email-provider-infra) below. The code path is live; the AWS-side production access and DKIM/MAIL FROM DNS records are still manual steps.
- A versioned, private, retained S3 bucket as the destination for scheduled database export bundles — see [§8](#8-backup-bucket) below.
- HTTPS subscriptions wiring both SNS topics to the app's webhook routes — see [§9](#9-webhook-subscriptions) below. Created on every deploy, no flag required.
- An access key for every one of its eight IAM users, delivered through one Secrets Manager secret
  holding a filled-in application `.env.example` plus named-profile blocks for workstation-only
  credentials, and one stable generated seed that derives the three app secrets — see
  [§10](#10-the-credentials-secret) below.
- A post-deploy wizard that offers Vercel env/deploy, GitHub secret, and Vercel DNS handoffs one
  yes/no question at a time. The short [manual-actions.md](manual-actions.md) contains only
  human account approvals.

---

## 1. AWS Credentials & Authentication

To provision or modify infrastructure, you must authenticate with AWS.

### Installing Prerequisites
Ensure the [AWS CLI](https://aws.amazon.com/cli/) is installed on your local machine.

Two credentials are in play and they are not interchangeable:

| | What it is | What it is for |
| --- | --- | --- |
| **Administrator profile** | An IAM identity that predates this stack, authenticated with `aws login` | Bootstrapping the account, the first deploy, and reading the credentials secret ([§10](#10-the-credentials-secret)). |
| **`cdk-deployer`** | Created *by* this stack; holds `sts:AssumeRole` on the four bootstrap roles and nothing more | Every subsequent `pnpm infra:deploy`. Not granted read on the credentials secret — but it can reach it anyway through the bootstrap roles, so treat it as an admin credential and keep it on your workstation only. See [§10](#10-the-credentials-secret). |

### Option A: Local AWS Profile (Recommended)
Every first-run `pnpm infra:*` command explicitly targets `diveday-admin`, then verifies it with STS
and automatically opens the browser `aws login --profile diveday-admin` flow. That creates the profile
when it does not yet exist and refreshes it when the session expires. Once the stack has been deployed
once, answer yes to the profile prompt after `pnpm infra:deploy`.
Even when an older raw deploy key can complete the CDK deploy, the post-deploy environment sync repeats
that administrator-profile check before it reads `diveday/env`.
It writes the generated identities as named `~/.aws/credentials` profiles — including
`diveday-deployer`, `reg-suit-bot`, service identities, and the local MCP reader — while preserving
unrelated profiles. It also writes the `diveday-admin` profile's `us-east-1` region to
`~/.aws/config`; the administrator *credential* still predates the stack and must be configured by
you. Before the generated deployer profile exists, the infrastructure commands select
`diveday-admin` whether or not its profile block has been written yet; afterwards `pnpm infra:deploy`,
`pnpm infra:synth`, and `pnpm infra:diff` select `diveday-deployer` by default. No generic deployment
credential belongs in `.env.local`.
If the generated `diveday-deployer` profile cannot call STS, the wrappers automatically switch to
`diveday-admin` and open that profile's browser login rather than trying to authenticate as the
limited deployer identity.

---

## 2. Bootstrapping the Environment

AWS CDK requires one-time bootstrapping of an AWS environment (combination of account and region) before you can deploy any stacks. This process provisions resources CDK needs to operate (like an S3 bucket for staging assets).

Bootstrap the intended administrator profile:
```bash
pnpm infra:bootstrap
```

The wrapper opens `aws login` if necessary, resolves the signed-in profile's AWS account with STS,
and requires you to type that 12-digit id before it changes anything. In a non-interactive terminal, pass
`--confirm-account <12-digit-account-id>`. It then uses the S3 Control API to disable
the four account-level Block Public Access flags before it runs `cdk bootstrap`. This permits the
public visual-report bucket; it does not make any other bucket public, and an AWS Organizations
policy can still reject the change. It deliberately does **not** require a root-user credential:
use an administrator identity in the intended root account, not a programmatic root key.

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

After CloudFormation succeeds, the command writes `.env.local`, `.env.vercel`, and `.env.github`,
then checks each optional handoff before asking whether it needs an update: generated AWS CLI
profiles, Vercel Production variables, GitHub visual-test secrets, the CI role-ARN repository
variables, the `infra-deploy` GitHub Environment reviewer, and SES DNS records through Vercel. A
handoff already current is omitted from the wizard; if its read-only check cannot prove that, its
question remains visible and the existing write step reports the failure. The final Vercel
Production deploy question is always explicit because a deploy can be intentional even when every
handoff is current. Press Enter or `n` to skip any shown question; `--no-wizard` skips all of it and
only creates the three files. In CI, the `deploy` job answers yes to every shown question
automatically instead — see
[ADR 20260811-ci-deploy-full-wizard](../architecture/decisions/20260811-ci-deploy-full-wizard.md) —
once the required-reviewer approval on `infra-deploy` has already gated the run. SES DNS defaults to
the `dive.day` Vercel zone; set `VERCEL_DNS_ZONE=example.com` for a different authoritative zone. The
Vercel CLI is pinned in this repository's dev dependencies and is invoked with `pnpm exec vercel`,
never downloaded ad hoc.

Each of `.env.local`, `.env.vercel`, and `.env.github` is rendered fresh on every deploy, from
exactly two sources: the `diveday/env` credentials document CloudFormation just produced, and
`.env.manual`, the one file a human edits (`distribute-env.mjs`; ADR
20260812-env-provenance-registry). Neither is a merge against whatever the file already held — a
value typed directly into `.env.local` does not survive the next deploy, and `.env.vercel`/
`.env.github` are never derived from `.env.local` either, only from the same two sources `.env.local`
itself came from. If a value needs to persist across deploys and isn't stack-produced, it belongs in
`.env.manual`, not in the generated file.

Each of these three sync steps only pushes what actually changed, not the whole document every
time — answering "yes" is safe to do on every deploy. DNS records (inline in
`post-deploy-wizard.mjs`) diff against what's already live, by listing the current records first.
Vercel variables (`import-vercel-env.mjs`) and GitHub secrets (`sync-github-secrets.mjs`) can't do
that — every value is pushed `--sensitive`, and Vercel never returns a sensitive value again once
set, exactly like the Actions secrets API never returns a value to any token. Vercel's diff instead
checks a SHA-256 fingerprint of each value against an SSM Parameter Store parameter,
`/diveday/env-sync/vercel/<environment>`, read and written under the same `diveday-admin` profile
this handoff already authenticates on a workstation — or, in CI, under
`GitHubActionsCdkDeployRole`'s own narrow grant on that one parameter path (ADR
20260811-ci-deploy-full-wizard) — never the values themselves (ADR
20260811-vercel-sync-checkpoint-in-ssm). The complete hashed state is checked before the first
Vercel value upload and refreshed after every successful sync, including a no-op, so removed
variables cannot remain in the checkpoint. GitHub's diff still checks a local checkpoint file,
`.env.github.synced`, gitignored, since that sync step has no AWS channel of its own. A value edited
directly in the Vercel dashboard or GitHub UI is invisible to either check and reads as still in
sync.

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

> [!IMPORTANT]
> **`CredentialSerial` is a CloudFormation *parameter*, not a context value** — the one input here
> that is not `--context`, and deliberately so. Context is per-invocation, so a rotation done with
> `--context` would be undone by the next deploy that forgot the flag, silently replacing all eight
> keys. CloudFormation remembers a parameter and `cdk deploy` defaults `--previous-parameters` to
> true, so omitting it is a no-op. See [§10](#10-the-credentials-secret).
>
> ```bash
> pnpm infra:deploy --parameters CredentialSerial=2
> ```

---

## 5. Outputs and Environment Configuration

A deploy prints two kinds of output, and the split is deliberate.

**Values you can act on** — names, ARNs, URLs, DNS records. `S3BucketName`, `S3WebsiteURL`,
`BackupBucketName`, `SesDkimRecords`, `SesMailFromRecords`, `SesEventNotificationsTopicArn`,
`SmsDeliveryReceiptsTopicArn`, `CredentialsSecretName`, `CostAlertEmail`, and `RetiredAccessKeys` —
the keys this deploy revoked because an identity held more than one, or `none` in the steady state
(see [§10](#10-the-credentials-secret)).

**The post-deploy handoff** — `PostDeployWizard` points to `pnpm infra:deploy`, which asks only
whether to take the external actions it can execute: Vercel variables, Vercel production deploy,
GitHub visual-test secrets, and SES DNS. [manual-actions.md](manual-actions.md) now contains only
the five account approvals that no CLI can complete.

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

- **`AWS::Budgets::Budget`** — a monthly `COST` budget, default $30 (raised from $5 on 2026-08-12,
  see the ADR's amendment), with five graduated email
  notifications: 50% and 80% of actual spend, 100% of *forecasted* spend (an early warning before
  the month even ends), 100% of actual spend, and 200% of actual spend as the "this is outside
  normal bands" siren. It has no fixed name (see the troubleshooting note below for why); find the
  AWS-assigned one in the `MonthlyCostGuardrailBudgetName` stack output, or Billing and Cost
  Management -> Budgets in the console.
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

- `alertEmail` — where every alert goes (default `alerts@dive.day`, the operational mailbox every
  other alert path in the product already used; it was a personal Gmail until 2026-08-06). Changing
  the default only takes effect on the next deploy, and the SNS email subscription it creates has to
  be confirmed from the mailbox before AWS will send to it.
- `monthlyBudgetLimit` — the monthly USD cap the percentage thresholds above are computed against
  (default `5`).

> **Troubleshooting: `cdk deploy` fails on `MonthlyCostGuardrail` with "A budget or resource with
> the same name but a different internalId already exists."** `Budget` (the nested object holding
> `budgetLimit`) is a Replacement-only property of `AWS::Budgets::Budget`, so changing
> `monthlyBudgetLimit` makes CloudFormation create a new budget resource before deleting the old
> one. Budgets enforces one name per account; a stack that pins a fixed `budgetName` collides on
> that create, because the old resource with the same name hasn't been deleted yet. The stack no
> longer sets `budgetName` for this reason (its name is AWS-assigned per create, so a replacement
> never collides with what it's replacing) — if you still hit this error, it means an orphaned
> budget from before that fix, or from a stack that failed mid-rollback, is sitting in the account
> outside this stack's tracking:
> 1. `aws budgets describe-budgets --account-id <ACCOUNT_ID> --query 'Budgets[].BudgetName'` to
>    find it.
> 2. Confirm it isn't one you want to keep, then `aws budgets delete-budget --account-id
>    <ACCOUNT_ID> --budget-name <NAME>`.
> 3. Retry `pnpm infra:deploy`.

The Budgets half needs no account-level setup — unlike a CloudWatch billing alarm on
`EstimatedCharges`, it doesn't need the "Receive Billing Alerts" console toggle enabled first. **Cost
Anomaly Detection does**: it depends on Cost Explorer, which is a one-time console opt-in with no
API, and reports nothing until it has accumulated spend history. That is a prerequisite in
[manual-actions.md](manual-actions.md), not something the stack handles.

**What this account costs when idle:** two Secrets Manager secrets at $0.80/month
([§10](#10-the-credentials-secret)) plus two CloudWatch custom metrics past the always-free ten at
$0.60/month ([cloudwatch-observability-runbook.md](cloudwatch-observability-runbook.md)) — about
**$1.40/month** of cost that exists whether or not anyone uses DiveDay. Everything else here is
per-use or genuinely free at this volume.

That $1.40 is the number the `monthlyBudgetLimit` default of `30` is set against. It was `5` until
2026-08-12, at which point the fixed floor was over a quarter of the cap and the 50% and 80%
notifications were on course to fire every month on cost that never changes — the exact "guardrail
becomes noise" failure the ADR was written to prevent. If you add fixed cost, move the limit with it.

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
| Removal policy | `RETAIN` | One of the two resources in this stack that must survive `cdk destroy` (the other is `DatabaseDumpBucket`, below). Deleting production backups should require a deliberate manual act |
| Lifecycle | One rule, about bundles: Infrequent Access at 30 days; Glacier **Instant** Retrieval at 90; non-current versions expire at 90 days; incomplete multipart uploads abort at 7 days. **Current versions never expire.** Nothing expires the `dumps/` prefix this bucket held until 2026-08-15 — those objects are abandoned deliberately (§2c of [backup-and-restore-runbook.md](backup-and-restore-runbook.md)) | Cost is managed by getting colder, not by deleting. Waiver retention is "indefinite" pending [H-02](../product/human-decisions.md), so a lifecycle rule must never be what decides evidence has outlived its usefulness. Glacier *Instant*, not Flexible or Deep, because a restore happens during an incident and a multi-hour thaw would make the backup useless exactly when it is needed |
| Uploader | IAM user `diveday-backup-uploader`, `s3:PutObject` + `s3:AbortMultipartUpload` on `arnForObjects("exports/*")` and nothing else | Write-only, same least-privilege posture as `cdk-deployer` in §5. A leaked uploader credential can neither read a shop's exported waivers back out nor destroy an existing backup. The prefix is load-bearing rather than tidy: this key ships to **Vercel**, and until 2026-08-15 the grant was `arnForObjects("*")` on a bucket that also held the full-cluster database dump, so a leaked environment could overwrite it |

**The database dump lives in its own bucket** (`DatabaseDumpBucket` / `diveday-database-dumps`,
`dumpBucketName` context value) and has since 2026-08-15. It is also `RETAIN`, also `BLOCK_ALL`,
also SSE-S3 + `enforceSSL` — and otherwise the opposite of this one: **versioning off**, and a
single unprefixed lifecycle rule expiring everything at 35 days. The two artifacts share almost
nothing (see the comparison table in
[ADR 20260812-platform-database-dump](../architecture/decisions/20260812-platform-database-dump.md)):
the bundles deliberately exclude `user_accounts`, the dump is every password hash and every medical
answer, and it is the only artifact that can restore a login. Colocating them meant every grant on
this bucket had to be *remembered* to be prefix-scoped; the one that was not is the one that shipped
a credential to a third party. No principal holding Vercel-resident credentials has any grant on the
dump bucket at all. The dumps written into this bucket before the split were left where they were and
are part of no recovery plan; the restore procedure, the deploy-day step, and the manual command for
clearing that abandoned prefix are in
[backup-and-restore-runbook.md](backup-and-restore-runbook.md) §2c.

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
[`.env.example`](../../.env.example) with the values filled in. A second secret,
`diveday/app-secret-seed`, is generated once by CloudFormation using the AWS-managed
Secrets Manager KMS key. The first document contains that seed, and
`scripts/distribute-env.mjs` uses HKDF labels to derive separate, stable values for
`AUTH_SECRET`, `SECRET_ENCRYPTION_KEY`, and `CRON_SECRET` before any target file is written.
After every successful `pnpm infra:deploy`, the wrapper reads `diveday/env` and automatically writes
`.env.local`, `.env.vercel`, and `.env.github`: on a workstation using the local `diveday-admin`
profile, in CI using `GitHubActionsCdkDeployRole`'s own narrow, resource-scoped read on exactly that
one secret (ADR 20260811-ci-deploy-full-wizard) — the ambient OIDC-assumed credentials already used
for the deploy, no profile swap. Set `INFRA_ENV_SYNC_PROFILE=<profile-name>` when the administrator
profile has a different name. The post-deploy read defaults to `us-east-1` if that profile has no
region configured.

**The resulting document supplies `.env.local` and named AWS CLI profiles.** `dotenv -c` loads the
app configuration through the usual local cascade; the helper leaves generic deployer credentials
blank there and the wizard can write them to `~/.aws/credentials`.

**Nothing merges.** Every key has exactly one producer, declared in
[`config/env-registry.mjs`](../../config/env-registry.mjs), and each target file is rendered from the
two sources that own values — this secret, and `.env.manual` — never from another target file (ADR
[20260812-env-provenance-registry](../architecture/decisions/20260812-env-provenance-registry.md)).
So:

- **`.env.manual` is the only file you edit.** It holds the values no system can mint: the Neon URL,
  the two Stripe secrets from 1Password, Meta's app credentials, the read-only usage tokens, and a
  couple of choices like `OPS_ALERT_EMAIL`. `pnpm env:manual` creates it, and on first run lifts
  those values out of a pre-split `.env.local` so nothing is re-pasted. `pnpm check:env` lists what
  is still blank and what each one switches off — every line may legitimately stay empty.
- **`.env.local` is generated and overwritten on every deploy.** An edit there is lost; make it in
  `.env.manual`.
- **A value the stack mints has no local override**, and putting one in `.env.manual` is refused
  rather than ignored. This is what the design is for: the previous version merged the secret into
  `.env.local` and let the file win, so a credential typed in by hand was pinned there forever — and
  since `.env.vercel` was then rendered *from* `.env.local`, it rode into Vercel Production and left
  the deployed address lookup signing with an access key AWS had never issued.

| Destination | What to take |
| --- | --- |
| `.env.local` | Generated: app configuration, minted credentials, derived app secrets, and whatever `.env.manual` supplies. Do not edit. |
| `.env.manual` | The one file you fill in, from 1Password and the provider consoles. Never generated over. |
| `~/.aws/credentials` | Generated profiles, written only when the wizard prompt is accepted. Existing unrelated profiles stay intact; `diveday-admin` receives only its `us-east-1` config entry because this stack never owns its credential. |
| Vercel | `.env.vercel`, then `node scripts/import-vercel-env.mjs .env.vercel production`. Rendered from the secret plus `.env.manual` — never from `.env.local` — so it excludes workstation/CI values and carries the Stripe secrets straight from 1Password. |
| GitHub Actions secrets | `.env.github`, then `gh secret set --env-file .env.github`. |
| `~/.aws/credentials`, Claude Code cloud env | The "Not .env values" section at the bottom. |

> [!WARNING]
> **Never put the `cdk-deployer` key in Vercel or any deployed environment.**
> It is delivered only in the named `diveday-deployer` AWS profile block. See [who can read it](#who-can-read-it) — it is administrator-
> equivalent on this account, the app has no use for it, and a Vercel environment variable is
> readable by every project member and reachable from any compromised dependency in the server
> bundle. It is the one key that yields all the others.

The credentials that do not belong in a dotenv file — `cdk-deployer`, the two read-only MCP users,
and the backup uploader — ride at the bottom in a commented section, each under the destination it
belongs to, so pasting the whole document into `.env.local` stays safe.

### Why the application section is `.env.example`

Because the application destination format should be the hand-off format. A bespoke JSON shape means
transcribing field by field and inventing a mapping from key names to variable names; `.env.example`
is already the shape of this project's app configuration. It is itself generated from
[`config/env-registry.mjs`](../../config/env-registry.mjs) — run
`node scripts/render-env-example.mjs --write` after adding a variable, and `pnpm check:env` fails if
the committed copy has drifted. The secret document is generated from that file at synth time, so:

- a variable renamed in `.env.example` renames itself in the secret on the next deploy;
- a value the stack claims to supply for a key `.env.example` no longer declares **fails the synth**
  rather than silently vanishing;
- a new `*_AWS_ACCESS_KEY_ID`-shaped variable added to `.env.example` and not filled by the stack
  fails `infra/lib/manual-actions.test.ts`.

The generic `cdk-deployer` credential is deliberately outside that application section, in a
commented `diveday-deployer` profile block. It is written to `~/.aws/credentials` by the wizard,
never copied to `.env.local`, and does not make `.env.example` an AWS-login template.

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
pnpm infra:deploy --parameters CredentialSerial=2
```

**It is a CloudFormation parameter, not a `--context` value, and that distinction is the safety
property.** Context is per-invocation: with context, the deploy *after* a rotation — any unrelated
deploy, run without the flag — would synthesize `Serial: 1` again, replace all eight keys, and delete
the ones you just placed. Email and SMS would start failing on `InvalidClientTokenId` with nothing
connecting it to the deploy. CloudFormation remembers a parameter, and `cdk deploy` defaults
`--previous-parameters` to `true`, so omitting the flag is a no-op. Check the deployed value with:

```bash
aws cloudformation describe-stacks --stack-name diveday-infra --query "Stacks[0].Parameters"
```

One serial covers all eight. They leave in a single document and land in the same four places, so a
partial rotation saves little, and eight parameters would be eight more things to keep straight.

### Revoking the keys the stack did not create

**IAM allows two access keys per user — hard, not adjustable.** Seven of these eight identities had
their keys made by hand before this stack minted any, and CloudFormation neither knows about those
nor deletes them. The deploy that adds a managed key therefore leaves each such user at the ceiling,
and the *next* rotation would call `CreateAccessKey` against a full user and fail with
`LimitExceeded` — on the day someone is rotating because something leaked. Nothing surfaces it in the
meantime: the deploy that creates the second key succeeds.

The stack revokes them itself (§13 in the stack file), rather than leaving it as a step to remember —
the whole hazard is that nobody knows it is armed. It is also what makes "revoke and re-create" a
usable answer to any exposure, instead of a procedure whose first attempt fails.

Two properties make it safe to automate:

- **It never touches a user holding fewer than two keys**, so it cannot leave an identity with none.
  Nothing to do is the steady state, and the `RetiredAccessKeys` output reads `none`.
- **It keeps the newest and deletes the rest.** CloudFormation created its key seconds earlier and
  the resource depends on all eight, so the newest is always the managed one.

It is deliberately **not** re-run on rotation: its properties name the users, not the key ids, so
bumping `CredentialSerial` does not re-invoke it. If it did, it would delete the outgoing key during
the same update in which CloudFormation is already deleting it — a race with the stack's own cleanup,
for no gain, because after one run every user holds exactly one key and rotation has the room it
needs natively.

> [!IMPORTANT]
> **Your current `cdk-deployer` key is one of the keys this revokes.** The deploy itself finishes —
> it runs under an assumed bootstrap role, not that key — but the next `pnpm infra:deploy` will fail
> until you paste the new deployer credentials out of the secret. Read them with the administrator
> profile, which is unaffected. If the deploy rolls back after the revocation, the deployer may be
> left with no key at all; the admin profile is the way back in.

The trade accepted in exchange: removing a key's construct from the stack now *deletes that key*,
breaking anything still holding it, where a hand-minted key would have survived untouched. That is
the correct default — a credential this stack no longer describes should stop working — but it is a
sharp edge worth knowing before deleting a user.

### Why two secrets, not ten

Secrets Manager bills $0.40 per secret per month and has no free tier. Eight credential secrets plus
three app-secret secrets would be $4.40 of fixed monthly cost — against the $5 budget this section
was written for that was permanent noise in the 50% and 80% notifications, and against today's $30
([ADR 20260802-aws-cost-guardrails](../architecture/decisions/20260802-aws-cost-guardrails.md), as
amended 2026-08-12) it is affordable but still eleven documents to keep straight. Two secrets cost $0.80:
one hand-off document and one stable root from which HKDF derives three independent app values. What
that costs is granularity: whoever can read the hand-off document reads all of it, a distinction that
is theoretical on this single-operator account.

### Who can read it

**Exactly one additional principal is granted read** — `GitHubActionsCdkDeployRole`, scoped to this
secret's own ARN and nothing else (ADR 20260811-ci-deploy-full-wizard) — and it is worth being exact
about what that buys, because the comfortable version of this sentence is wrong.

**The read-only MCP users are genuinely bounded.** They carry an explicit `Deny` on
`secretsmanager:GetSecretValue` for every secret, and a Deny beats any Allow — so the guarantee holds
regardless of what AWS adds to the managed `ReadOnlyAccess` policy next.

**`cdk-deployer` is not bounded, and it would be dishonest to say otherwise.** It can assume
`cdk-<qualifier>-deploy-role`; that role passes a CloudFormation execution role; and a plain
`cdk bootstrap` — which is what `pnpm infra:bootstrap` runs — leaves that execution role at
`AdministratorAccess`, because `--cloudformation-execution-policies` defaults to empty and the
bootstrap template's own default applies. So a holder of the deployer key can deploy a one-resource
stack that reads this secret. Withholding `grantRead` costs them a step, not the capability.

Two consequences follow, and both are load-bearing:

- **The deployer key is the one that yields all the others.** That is why it is marked
  workstation-only in the document and in [`.env.example`](../../.env.example), and why it must never
  reach Vercel or CI.
- **If you want it actually bounded, that happens at bootstrap**, with scoped
  `--cloudformation-execution-policies`. It is a manual action, noted on the `cdk-bootstrap` entry in
  [manual-actions.md](manual-actions.md), and it is not done today.

Read the secret with the administrator profile, or in the console signed in as the account owner. It
is a hand-off point for a human, so a human's credential is the one that opens it — and, once that
same human has approved the `infra-deploy` GitHub Environment for a specific CI run, the one CI
identity that reaches this secret at all reads only this one document, never anything else in the
account.

> [!NOTE]
> Nothing reads this secret at runtime. The app never calls Secrets Manager; it reads environment
> variables that a person put there. The IAM keys are the system of record and this is a copy of them
> for you to move — which is also why the secret carries `RemovalPolicy.DESTROY`: once the stack is
> gone its users and keys are gone too, and a retained document of dead credentials that still looks
> live is worse than no document. CloudFormation deletes secrets with `ForceDeleteWithoutRecovery`,
> so there is no 7–30 day window blocking a redeploy under the same name.
