# Moving the estate to another AWS region

DiveDay's regions are three constants in [config/aws-regions.mjs](../../config/aws-regions.mjs), and this is what changing one of them actually costs.

Today all three are `us-east-1` (ADR [20260924-one-region-in-us-east-1](../architecture/decisions/20260924-one-region-in-us-east-1.md)); `ROUTE53_METRICS_REGION` is not a choice (ADR [20260910-one-region-in-us-east-2](../architecture/decisions/20260910-one-region-in-us-east-2.md)).
This page and `pnpm infra:migrate-region` move `PRIMARY_REGION`, with `SES_REGION` alongside it; moving `SES_REGION` on its own is [its own procedure](ses-email-runbook.md#moving-mail-to-another-region).

Read this before editing either of the first two.
The edit is one line; the move is not.

> [!WARNING]
> This document is written for a **pre-pilot** estate (H-49) whose buckets hold seed rows, visual-regression baselines and demo photos.
> It says "delete the bucket" in several places and means it.
> Once a real shop has a photo in `diveday-media` or a bundle in `diveday-backups`, the teardown step below is a data migration instead, and none of the timings here hold.

## Why it is a teardown and not a cutover

Two classes of AWS name are **global**, not regional, and the estate uses both.

**S3 bucket names.**
`diveday-media`, `diveday-backups`, `diveday-database-dumps`, `diveday-vrt` and `diveday-inbound-mail` are literal names, not generated ones — deliberately, because the app, the runbooks and the credentials document all say them out loud.
A stack in the new region asks CloudFormation to create a bucket whose name the old region already owns, and gets `BucketAlreadyOwnedByYou` part-way through the deploy.

**IAM user names.**
IAM is global, so `diveday-ses-sender`, `diveday-media-uploader`, `diveday-backup-uploader`, `cdk-deployer`, `reg-suit-bot` and `diveday-sns-sms-sender` all fail with `EntityAlreadyExists` for the same reason.

Deleting the old stack is necessary and not sufficient: three of those buckets carry `RemovalPolicy.RETAIN`, so CloudFormation deliberately leaves them behind for a person to decide about.

## What moves by itself, and what does not

| | |
| --- | --- |
| **Follows the constant** | Every Lambda, log group, metric filter, alarm, scheduler rule, CodeBuild project, Secrets Manager secret, SNS topic, S3 bucket and the CloudFront distribution. CloudFormation creates them in the new region and deletes them from the old one when the old stack goes. |
| **Cannot follow** | The Route 53 health-check alarms. `AWS/Route53 HealthCheckStatus` is published in us-east-1 only, so they are their own stack, pinned. Nothing to do on a move — that is the whole point of the split. |
| **Has to be done again by a human** | SES production access, the DKIM CNAMEs, the MAIL FROM MX, the inbound MX, the receipt-rule-set activation, the SMS sandbox exit, the SMS spend limit, the origination-identity registration, and three alarm-subscription confirmation clicks. |
| **Does not come with you** | CloudWatch log history, metric history, alarm history, and the RUM app monitor's collected sessions. The new region starts empty; the old region keeps its data until something deletes it. |

### The slow one

Leaving the SNS SMS sandbox, raising the spend limit above $1, and registering a US origination identity are **per region**, and 10DLC vetting with the carriers is measured in weeks.
Start it the day the move is decided, not the day the deploy lands.

### CloudFront

The distribution itself is a global resource and works with an S3 origin in any region, so the region is not the interesting part.
Two things are.

No ACM certificate is involved.
The media distribution serves from CloudFront's own `*.cloudfront.net` domain rather than a custom one, so the rule that CloudFront certificates must live in us-east-1 does not bite here.
It would if a custom domain were ever added — and it would keep biting after a move, because that certificate would still have to be in us-east-1 while everything else was elsewhere.

The distribution is replaced.
It is defined in the main stack, so a stack in a new region creates a *new* distribution with a *new* domain, and `MEDIA_PUBLIC_URL_BASE` changes with it.
Every media URL already written into the database keeps the old domain and 404s once the old distribution is deleted.
Pre-pilot that is seed data and a `pnpm db:reset` away; after a pilot it is a column rewrite.

A distribution also takes about fifteen minutes to deploy, and has to be disabled before it can be deleted — so the teardown below is slower than it reads.

## The order

There is a script: `pnpm infra:migrate-region`.

It defaults to an inventory and changes nothing. Run it first, read what it says it would delete, and only then re-run with `--execute`.

```bash
pnpm infra:migrate-region --from us-east-2                       # inventory only
pnpm infra:migrate-region --from us-east-2 --execute             # do it
pnpm infra:migrate-region --from us-east-2 --execute --from-step 3   # resume
```

It uses the `diveday-admin` profile, strips any ambient deployer key, reads the account off `sts:GetCallerIdentity` rather than assuming it, and makes you type the region name before the first delete.
With no terminal to ask in it refuses outright unless `--confirm-teardown <region>` is passed, which is a flag that names what it destroys and authorizes nothing else.
Steps 1 to 4 are idempotent: a resource that is already gone is "already done", not an error, so a run that dies half-way can be resumed rather than restarted.
The destructive run's first line is `Starting at step N of 5.` — read it before anything else happens.

**Resuming after the deploys have begun is `--from-step 3`, never a fresh run.**
Step 1 finds the old estate by *global* name, and once `diveday-infra` exists in the new region every one of those names is the new estate's.
So step 1 refuses outright when `diveday-infra` exists in `PRIMARY_REGION`, or `diveday-email` exists in `SES_REGION` while mail is moving, and names the stack and its status.
That refusal is the whole answer: do not delete anything it names to get past it.

Nothing is done by hand before the script, including when mail is moving too.

What each step does:

1. **Tear down.**
   Refuses if the new estate already exists.
   Otherwise empties every bucket S3 places in the old region, deletes `diveday-infra` there, and — when `SES_REGION` is not the old region — takes the old `diveday-email` down too: it deactivates the old region's receipt rule set if the active one is `diveday-inbound` (an active set blocks the stack delete), then deletes the stack.
   Then it deletes the retained buckets, `diveday-inbound-mail` among them, purges the secrets, and verifies every global name is free before letting the next step run.
   A bucket that exists under one of the estate's names in any *other* region is reported and never touched, and the final check says which kind of "still taken" it found: a name still in the old region is step 1's unfinished business; one held anywhere else belongs to something this script does not know about, and is for a person to investigate rather than delete.
   When mail stays in the old region, neither `diveday-email` nor `diveday-inbound-mail` is part of the move and neither is touched.
2. **Bootstrap** every region in `DEPLOY_REGIONS`.
3. **Deploy `DiveDay` alone.**
   Its own per-region grants come from this stack, so nothing else can be deployed or diffed until it has landed once.
4. **Deploy `DiveDayEmail` alone, then all three stacks.**
5. **Print what is left**, which is the list in the next section.

Steps 3 and 4 treat each stack's create the same way.
Before each attempt, a stack a failed create left behind (`ROLLBACK_COMPLETE`, `CREATE_FAILED`, `REVIEW_IN_PROGRESS`) is deleted, and whatever that create orphaned is swept — fixed-name log groups, and the `RETAIN` buckets and secrets its template names, a bucket only when S3 places it in the region being built.
If the sweep freed a bucket, the deploy waits five minutes first.
A deploy that fails is retried, up to seven times, only when the stack's events say AWS has not caught up yet: S3's 409 `OperationAborted` on a name deleted minutes ago, or SES's "Your bucket must be in the same region as your Amazon SES configuration" on an inbound bucket that just moved.
Any other failure stops the run.

What each step does:

1. **Tear down.**
   Empties every old bucket, deletes `diveday-infra` in the old region, deletes the retained buckets, purges the secrets, then verifies every global name is free before letting the next step run.
2. **Bootstrap** every region in `DEPLOY_REGIONS`.
3. **Deploy `DiveDay` alone.**
   Its own per-region grants come from this stack, so nothing else can be deployed or diffed until it has landed once.
4. **Deploy all three stacks.**
5. **Print what is left**, which is the list in the next section.

### Why this is a script and not a list of commands

Every step has a trap that a careful person executing a list still walks into; these are the ones that come from the estate, and the us-east-2 → us-east-1 move on 2026-09-26 added three that come from the order.

- `diveday-vrt` is `RemovalPolicy.DESTROY` with no `autoDeleteObjects`, so leaving objects in it fails the *stack deletion* half-way, after the CloudFront distribution has already gone. It has to be emptied before the delete, not after.
- Three buckets are `RETAIN`, so the stack deletion deliberately leaves them behind holding their global names.
- `diveday-backups` is versioned, so `aws s3 rm --recursive` writes a delete marker per object and keeps every byte. The bucket reads as empty and `delete-bucket` still answers `BucketNotEmpty`.
- `diveday/env` and `diveday/app-secret-seed` are `DESTROY`, which *schedules* deletion with a recovery window. For up to 30 days after the old stack is gone, reading `diveday/env` from the old region succeeds and hands back the dead estate's credentials document. The script purges them instead.
- A bucket name is global and a bucket is regional. On 2026-09-26 a re-run started at step 1 against the already-built new estate, found every name "present", emptied and deleted the new estate's buckets, and stopped asking for the new stack's IAM users to be deleted by hand. Hence the refusal and the region check.
- SES checks that the inbound bucket is in its own region, and for a while after `diveday-inbound-mail` is recreated somewhere new it still sees the old one. The email stack's create fails, and the rollback keeps the `RETAIN` bucket, so the next create fails "already exists". Step 4 now sweeps and retries that like step 3 does for the main stack.
- The old `diveday-email` had to be taken down by hand, rule set first, before the script would work. Step 1 does it now.

## What the script leaves you

1. **Redo the DNS**, from the email stack's outputs.
   New region means new DKIM tokens, and both MX records name the region.
   Each MX is a delete-then-add, never an add: SES refuses the MAIL FROM setup outright if the subdomain carries more than one, and the post-deploy wizard will find a rival MX, name it, and skip its own add rather than leave two.
2. **Activate the receipt rule set** (manual action `ses-inbound-rule-set-active`).
   One active set per region, and it is a region-wide switch with no CloudFormation resource behind it.
3. **File the SES production-access request** in the new region (manual action `ses-production-access`).
   A fresh sandbox and a fresh case.
   Until it is granted, sending is limited to pre-verified addresses and the mailbox simulator, and no `Reputation.*` metrics are published at all.
4. **Start the SMS registrations** (manual action `sns-sms-account-limits`).
   Sandbox exit, spend limit, origination identity.
   The 10DLC vetting is measured in weeks, so start it the day the move is decided rather than the day a shop needs a text message to arrive.
5. **Confirm three alarm subscriptions** (manual action `confirm-observability-alarms`).
   One mail per alarm topic, and the links expire after three days.
6. **Check the address card still works.**
   Amazon Location's Places API is not served in every region, and the SDK builds `geo-places.<region>.amazonaws.com` with no ruleset check behind it — so an unserved region fails in DNS on every keystroke, with no HTTP status and no exception name to read.
   `aws geo-places search-text --query-text test --region <new region>` answers that in one call.
7. **Redeploy the app.**
   `RUM_APP_MONITOR_ID`, `MEDIA_PUBLIC_URL_BASE` and every AWS credential in the environment changed.
   The post-deploy wizard pushes the credentials; the redeploy is what makes the app use them.
8. **Re-paste the database connection string** (manual action `database-dump-connection`).
   The secret lives in the same account and region as the stack, so a move creates a fresh one holding the literal `unset`, and the weekly dump refuses to run rather than writing a zero-byte object.
   That refusal is the correct behaviour and it is also silent: the first Monday after a move produces no backup and no complaint.
   It is the only backup layer that can restore a login — the per-shop export bundles exclude `user_accounts`, `account_tokens` and `calendar_feeds` — so losing it quietly costs more than losing the bundles quietly.

   ```
   aws secretsmanager put-secret-value --secret-id diveday/database-url-unpooled --secret-string '<DATABASE_URL_UNPOOLED from Neon, the direct endpoint>'
   aws codebuild start-build --project-name diveday-database-dump
   ```
9. **Re-confirm both webhook subscriptions** (manual action `verify-webhook-subscriptions`), *after* the redeploy above and not with the other verifications.
   A move replaces both topics, so both subscriptions are recreated pointing at an app that does not yet know the new ARNs, and each route answers 503 until its ARN is in the running app's environment.
   SNS deletes an unconfirmed subscription after roughly three days, so a check run before the redeploy passes nothing and buys nothing.

   ```
   aws sns list-subscriptions-by-topic --region <new region> --topic-arn <SesEventNotificationsTopicArn>
   aws sns list-subscriptions-by-topic --region <new region> --topic-arn <SmsDeliveryReceiptsTopicArn>
   ```

   Both must answer a real `SubscriptionArn` rather than `PendingConfirmation`.

## Afterwards

Check that the old region is actually empty.
CloudFormation deletes what its template stops describing, but a retained bucket, a log group outside a stack, a Route 53 health check created by hand, or a CloudWatch alarm someone added in the console all survive a stack deletion and quietly cost money.

`aws cloudformation list-stacks --region <old region>` should show the CDK bootstrap stack, which is harmless to leave, and `diveday-global`, which is meant to be there.
Nothing else.
