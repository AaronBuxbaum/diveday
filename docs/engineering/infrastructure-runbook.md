# Infrastructure Provisioning Runbook

How to provision and manage AWS infrastructure for DiveDay using the AWS CDK (Cloud Development Kit).

All infrastructure is defined as code under the [infra/](../../infra/) directory in TypeScript.

---

## Overview

We use AWS CDK to model, deploy, and update our cloud resources. Currently, the infrastructure consists of the `DiveDay` stack, which provisions:
- An S3 bucket for storing visual regression testing (VRT) baselines and HTML reports.
- A `reg-suit-bot` IAM user with specific S3 read/write permissions.
- A dedicated `cdk-deployer` IAM user with `AdministratorAccess` intended to manage all future CDK deployments.
- Read-only IAM users for the AWS MCP server (local dev and Claude Code's cloud environment).
- Cost guardrails: an `AWS::Budgets::Budget` and AWS Cost Anomaly Detection — see [§6](#6-cost-guardrails) below.
- Dormant SES/SNS infra preparing a possible future swap off Resend — see [§7](#7-ses-email-provider-prep-dormant) below. Nothing here is live; the app still sends through Resend.

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

Pass these values during deployment or synthesis using the `--context` flag:
```bash
pnpm infra:deploy --context bucketName=my-custom-prod-bucket --context userName=my-custom-bot-user
```

---

## 5. Outputs and Environment Configuration

Upon successful deployment, the CDK CLI outputs key resources and credentials. Map these to your `.env.local` to allow the application or CI runner to communicate with AWS:

- **CDK Deployer User (`cdk-deployer`):** Use the outputted credentials (`CdkDeployerAccessKeyId`/`CdkDeployerSecretAccessKey`) for subsequent CI/CD deployments to avoid using root credentials.
- **S3 Bucket Details:** Use `S3BucketName` and `IAMUserAccessKey` / `IAMUserSecretKey` for S3 upload plugins.

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

## 7. SES email-provider prep (dormant)

The stack also provisions the AWS-side groundwork for a possible future move off Resend, entirely
inert until the app is reconfigured to use it. See
[ADR 20260802-ses-email-transition-prep](../architecture/decisions/20260802-ses-email-transition-prep.md)
and [ADR 20260802-ses-adapter-and-webhook](../architecture/decisions/20260802-ses-adapter-and-webhook.md)
for the full reasoning — this section is the "how to actually use it later" reference.

**What's provisioned now (AWS side):**
- An `ses.EmailIdentity` for `sesEmailDomain` (context value, default `ses.dive.day` — a subdomain
  distinct from Resend's `send.dive.day` on purpose, so DKIM/SPF and sending reputation for the two
  providers never collide while both exist).
- Easy DKIM signing (SES's default) — the `SesDkimRecords` output has the three CNAME records to add
  to DNS.
- An `ses.ConfigurationSet` wired to a new SNS topic (`SesEventNotificationsTopicArn` output) for
  bounce/complaint/delivery events — same event set the Resend webhook tracks.
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
Both are dormant — Resend stays the live provider unless `EMAIL_PROVIDER=ses` is explicitly set.
Relevant env vars, none of which do anything unless that flag is on:

| Variable | Purpose |
| --- | --- |
| `EMAIL_PROVIDER` | Set to `ses` to switch the live provider. Anything else (including unset) stays on Resend. |
| `SES_AWS_REGION` / `SES_AWS_ACCESS_KEY_ID` / `SES_AWS_SECRET_ACCESS_KEY` | The `diveday-ses-sender` IAM user's own credentials — never the `cdk-deployer` or `reg-suit-bot` ones. |
| `SES_FROM_EMAIL` | The sender address on `sesEmailDomain`. |
| `SES_SNS_TOPIC_ARN` | `SesEventNotificationsTopicArn`'s value — `/api/webhooks/ses` answers 503 without it, and rejects a correctly-signed message from any other topic. |

**What's still manual before this becomes the live provider** (deliberately not automated):
1. Add the `SesDkimRecords` CNAME records to `ses.dive.day`'s DNS and wait for verification.
2. Request SES **production access** (an AWS Support case — CDK cannot do this) once ready to send
   beyond the sandbox's verified-recipients-only limit.
3. Mint the `diveday-ses-sender` access key and set the env vars above in the real deploy
   environment (never the repo).
4. Subscribe `/api/webhooks/ses` to `SesEventNotificationsTopicArn` in the SNS console (or via a
   future CDK subscription) — the route auto-confirms the handshake once SNS calls it, but something
   has to point SNS at the URL first.
5. Set `EMAIL_PROVIDER=ses` deliberately, only after 1-4 are done.

Override the domain the same way as other context values:
```bash
pnpm infra:deploy --context sesEmailDomain=ses.example.com
```
