# Moving the estate to another AWS region

DiveDay's regions are three constants in [config/aws-regions.mjs](../../config/aws-regions.mjs), and this is what changing one of them actually costs.

Today `PRIMARY_REGION` and `SES_REGION` are both `us-east-2`; `ROUTE53_METRICS_REGION` is `us-east-1` and is not a choice (ADR [20260910-one-region-in-us-east-2](../architecture/decisions/20260910-one-region-in-us-east-2.md)).

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

Nothing here is reversible in the middle, so read it through once before starting.

1. **Start the SMS registrations in the new region** (manual action `sns-sms-account-limits`).
   Weeks of lead time; everything else is hours.
2. **Change the constants.**
   `PRIMARY_REGION`, and `SES_REGION` if mail is moving too.
   Nothing else in the repository names a region: the stacks, both deploy scripts, the bootstrap script and the main stack's IAM grants all read `config/aws-regions.mjs`.
3. **Bootstrap the new region.**
   `pnpm infra:bootstrap` does every region in `DEPLOY_REGIONS` in one run.
4. **Tear the old estate down** (manual action `region-move-teardown`).
   Delete `diveday-infra` in the old region and wait for it; then empty and delete each retained bucket by hand.
   Confirm the names are free — `aws s3api head-bucket` answering 404 and `aws iam get-user` answering `NoSuchEntity` — before going on.
5. **Deploy the main stack alone**: `pnpm infra:deploy DiveDay`.
   This has to be its own step on the first pass.
   The deployer user and the two CI roles get their per-region grants *from this stack*, so until it has run once in the new region the identities that deploy and diff cannot see the other two stacks at all.
   The failure otherwise is `AccessDenied ... cloudformation:DescribeStacks`, naming a grant three files down in the same diff.
6. **Deploy everything**: `pnpm infra:deploy`.
   All three stacks, the email and global ones for the first time in their regions.
7. **Let the post-deploy wizard finish.**
   Every access key in the estate is new — the credentials secret was recreated, so CloudFormation minted fresh keys for every IAM user — and the wizard is what pushes them to Vercel, GitHub and 1Password.
   Nothing holding an old key still works.
8. **Redo the DNS.**
   The DKIM CNAMEs are new tokens; the MAIL FROM MX and the inbound MX both name the region.
   Each MX is a delete-then-add, never an add: SES refuses the MAIL FROM setup outright if the subdomain carries more than one, and the wizard will find a rival MX, name it, and skip its own add rather than leave two.
9. **Activate the receipt rule set** (manual action `ses-inbound-rule-set-active`).
   One active set per region, and it is a region-wide switch with no CloudFormation resource behind it.
10. **File the SES production-access request** in the new region (manual action `ses-production-access`).
    A fresh sandbox and a fresh case.
    Until it is granted, sending is limited to pre-verified addresses and the mailbox simulator, and no `Reputation.*` metrics are published at all.
11. **Confirm three alarm subscriptions** (manual action `confirm-observability-alarms`).
    One mail per alarm topic, and the links expire after three days.
12. **Redeploy the app.**
    `RUM_APP_MONITOR_ID`, `MEDIA_PUBLIC_URL_BASE` and every AWS credential in the environment changed.

## Afterwards

Check that the old region is actually empty.
CloudFormation deletes what its template stops describing, but a retained bucket, a log group outside a stack, a Route 53 health check created by hand, or a CloudWatch alarm someone added in the console all survive a stack deletion and quietly cost money.

`aws cloudformation list-stacks --region <old region>` should show nothing of DiveDay's but the CDK bootstrap stack, which is harmless to leave.
