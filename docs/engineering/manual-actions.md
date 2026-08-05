# Manual actions

> [!NOTE]
> Generated from the registry in [infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts).
> Do not edit by hand — run `pnpm test infra -u` to regenerate after changing the registry.

Every step `cdk deploy` cannot perform itself, in one place, in one shape: **when** it
applies, **why** the stack cannot do it, **what** to run, and **where** the result goes.
The same blocks are printed as stack outputs after every deploy, so the checklist is in
front of whoever just deployed rather than in a document they have to remember to open.

Reasoning for each item lives in [infrastructure-runbook.md](infrastructure-runbook.md);
this file is the checklist, not the argument.

## Prerequisites

```text
[1] Install the AWS CLI and configure an administrator profile
    when     once per workstation
    why      Bootstrapping an account and reading the credentials secret both need a credential that predates this stack. The cdk-deployer user it creates cannot do either.
    run      aws configure --profile diveday-admin
    store    ~/.aws/credentials, under the profile name you passed above.
    note     The only long-lived administrator credential in this picture. Everything else in the checklist exists to replace a use of it, so it should be reached for rarely and stored like it matters.

[2] Bootstrap the account for CDK
    when     once per account and region
    why      CDK deploys through four roles that a bootstrap stack provisions. §5's deployer holds sts:AssumeRole on exactly those four ARNs and nothing else, so without them it can deploy nothing.
    run      AWS_PROFILE=diveday-admin pnpm infra:bootstrap
    produces The cdk-<qualifier>-{deploy,file-publishing,image-publishing,lookup}-role roles.
    verify   aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version
    note     Two defaults this leaves wide. (1) If you bootstrap with --qualifier, infra-stack.ts §5 builds the four role ARNs from the @aws-cdk/core:bootstrapQualifier context value — set it to match, or the deployer's AssumeRole silently matches nothing. (2) --cloudformation-execution-policies defaults to empty, so the execution role the deploy role passes gets AdministratorAccess. That makes cdk-deployer administrator-equivalent by transitivity, whatever this stack grants it directly — including reach to the credentials secret nothing is granted read on. Pass scoped policies here to bound it; otherwise treat the deployer key as an admin credential and keep it off every deployed environment.

[3] Allow public S3 buckets at the account level
    when     once per account, before the first deploy
    why      The visual-regression bucket serves its HTML reports publicly. Account-level Block Public Access overrides the bucket's own settings and is on by default on accounts created since April 2023, so the deploy either fails or produces a bucket whose website endpoint 403s. There is no CloudFormation resource for the account-level setting.
    run      aws s3control get-public-access-block --account-id <account-id>
             Turn BlockPublicAcls / BlockPublicPolicy / IgnorePublicAcls / RestrictPublicBuckets off in the S3 console's Block Public Access settings for this account.
    verify   curl -s -o /dev/null -w '%{http_code}\n' <S3WebsiteURL output>

[4] Enable Cost Explorer
    when     once per account
    why      The Cost Anomaly Detection monitor (infra-stack.ts §7) depends on Cost Explorer, which is a one-time console opt-in with no API, and produces no findings until it has accumulated spend history. The AWS::Budgets::Budget alongside it needs nothing.
    run      Billing and Cost Management console -> Cost Explorer -> enable.
    verify   aws ce get-anomaly-monitors --query 'AnomalyMonitors[].MonitorName'
```

## Credentials

```text
[5] Copy the credentials secret into .env.local
    when     after the first deploy, and after rotating any credential
    why      The secret is written by the deploy; putting its contents where a process will read them is a human act on a machine and a platform CloudFormation has no reach into.
    run      AWS_PROFILE=diveday-admin aws secretsmanager get-secret-value --secret-id diveday/env --query SecretString --output text
    produces .env.example with every value this stack can supply already filled in, plus a commented section for the credentials that do not belong in a dotenv file.
    store    .env.local at the repo root (gitignored). It is a complete file — paste over the whole thing, then fill the blanks. The stack supplies AWS credentials and topic ARNs and nothing else, so everything non-AWS stays empty (DATABASE_URL, AUTH_SECRET, APP_HOST, STRIPE_*, META_*, SECRET_ENCRYPTION_KEY, CRON_SECRET, NEXT_PUBLIC_SENTRY_DSN), as do the AWS values that are a choice rather than a credential (SES_FROM_EMAIL, SNS_SENDER_ID, REG_SUIT_GITHUB_CLIENT_ID).
    verify   pnpm check:env

[6] Put the app's AWS credentials into Vercel
    when     after the first deploy, and after rotating any of them
    why      Vercel runs the app; CDK runs the infrastructure. Neither deploy pipeline can write to the other, so the values cross by hand.
    run      Copy ONLY the SES_*, SNS_*, SMS_*, and PLACES_* lines out of the secret — not the whole document.
             Vercel -> diveday -> Settings -> Environment Variables -> Import .env, and paste those lines.
             Then redeploy the app: the values are read at request time from the build's environment.
    store    Vercel Production environment: SES_AWS_REGION, SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL, SES_SNS_TOPIC_ARN, SNS_AWS_REGION, SNS_AWS_ACCESS_KEY_ID, SNS_AWS_SECRET_ACCESS_KEY, SMS_SNS_TOPIC_ARN, PLACES_AWS_REGION, PLACES_AWS_ACCESS_KEY_ID, PLACES_AWS_SECRET_ACCESS_KEY.
    verify   curl -s -o /dev/null -w '%{http_code}\n' -X POST <webhookHost>/api/webhooks/ses -d '{}'
             Anything but 503. A 503 means SES_SNS_TOPIC_ARN is still unset in the running deployment.
    note     Never AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. Those are the cdk-deployer key, which can assume the CDK bootstrap roles and is therefore administrator-equivalent on this account. The app has no use for it, and a Vercel environment variable is readable by every project member and reachable from any compromised dependency in the server bundle. The document marks that block workstation-only for exactly this reason.

[7] Put the reg-suit credentials into GitHub Actions secrets
    when     after the first deploy, and after rotating reg-suit-bot
    why      CI compares visual baselines against the visual-regression bucket (infra-stack.ts §1). GitHub is a third platform, and its secrets are write-only through an API this stack has no credential for.
    run      GitHub -> the repository -> Settings -> Secrets and variables -> Actions.
    store    Repository secrets REG_SUIT_S3_BUCKET_NAME, REG_SUIT_AWS_ACCESS_KEY_ID, REG_SUIT_AWS_SECRET_ACCESS_KEY (consumed by .github/workflows/ci.yml). REG_SUIT_GITHUB_CLIENT_ID is not from this stack — it comes from the reg-suit GitHub app.
    verify   Push a branch and confirm the visual job uploads a report rather than skipping.

[8] Place the credentials that are not .env values
    when     after the first deploy, and after rotating them
    why      An AWS CLI profile is an INI file on a workstation and Claude Code's cloud environment is another vendor's settings page. Both are outside anything CloudFormation addresses.
    run      Read the secret and scroll to the 'Not .env values' section; each block names its destination.
    store    diveday-mcp-readonly-local -> a named profile in ~/.aws/credentials. diveday-mcp-readonly-cloud -> the Claude Code cloud environment's variables. diveday-backup-uploader -> nowhere yet; the scheduled export has no runner (backup-and-restore-runbook.md).

[9] Rotate every credential
    when     on suspected exposure, on operator change, or on a schedule you choose
    why      Rotation itself is a deploy — CloudFormation replaces each key when Serial increases. What stays manual is re-placing the new values everywhere the old ones went, because those destinations are the four platforms above.
    run      pnpm infra:deploy --parameters CredentialSerial=<previous + 1>
    store    The same four destinations as the placement steps above: .env.local, Vercel's environment variables, GitHub Actions repository secrets, and the off-dotenv homes. All eight keys rotate together, so all four need re-doing.
    verify   aws iam list-access-keys --user-name diveday-ses-sender — one key, created just now.
             aws cloudformation describe-stacks --stack-name diveday-infra --query "Stacks[0].Parameters" — CredentialSerial is the value you passed.
    note     The serial is a CloudFormation parameter rather than a --context value, so a later deploy that omits it keeps the deployed value instead of rotating everything back to 1 (cdk deploy defaults --previous-parameters to true). It may only ever increase. Nothing warns you that a stale copy of an old key is still in use somewhere.
```

## DNS

```text
[10] Add the SES DKIM records
    when     once per sending domain
    why      Authoritative DNS for dive.day is Vercel, not Route53 — this stack has no hosted zone to write into. Adding one would mean replicating the live mail records and replacing Vercel's apex ALIAS with anycast A records Vercel owns and rotates.
    run      Read the SesDkimRecords output: three CNAME name/value pairs.
    store    Vercel -> dive.day -> DNS. Three CNAME records on the SES identity subdomain.
    verify   aws sesv2 get-email-identity --email-identity <sesEmailDomain> --query DkimAttributes.Status  # SUCCESS

[11] Add the SES custom MAIL FROM records
    when     once per sending domain
    why      Same reason as the DKIM records: the zone is at Vercel.
    run      Read the SesMailFromRecords output: one MX and one TXT.
    store    Vercel -> dive.day -> DNS, on the MAIL FROM subdomain. Exactly one MX record — SES fails the setup outright if the subdomain has several.
    verify   aws sesv2 get-email-identity --email-identity <sesEmailDomain> --query MailFromAttributes.MailFromDomainStatus  # SUCCESS
```

## AWS account

```text
[12] Request SES production access
    when     once, before sending to anyone who has not verified their address
    why      A human-reviewed AWS Support case. There is no API.
    run      SES console -> Account dashboard -> Request production access.
    produces Sending to arbitrary recipients. Until then SES is in the sandbox: pre-verified addresses and the mailbox simulator only.
    verify   aws sesv2 get-account --query ProductionAccessEnabled

[13] Leave the SMS sandbox, raise the spend limit, register an origination identity
    when     once, before sending SMS to a diver
    why      All three are account-level SMS state. The sandbox exit and any spend limit above $1 are Support cases; a US origination identity (10DLC or toll-free) is a vetted registration with the carriers. The SetSMSAttributes custom resource (infra-stack.ts §10) deliberately touches none of them — it sets delivery-status logging and nothing else.
    run      SNS console -> Text messaging (SMS) -> Exit SMS sandbox (a Support case).
             Service Quotas -> Amazon SNS -> Account spend threshold for SMS (default $1/month).
             SNS console -> Text messaging (SMS) -> Origination identities, for US traffic.
    verify   aws sns get-sms-attributes --attributes MonthlySpendLimit
    note     Skipping this does not fail anything visibly: the pipeline reads healthy end to end while sends are capped or dropped.

[14] Re-adopt the retained backup bucket
    when     only after a cdk destroy, and only if you then redeploy
    why      The backup bucket (infra-stack.ts §11) carries RemovalPolicy.RETAIN so production backups survive a destroyed stack. CloudFormation then tries to create a bucket whose name is already taken and the deploy fails.
    run      Import the existing bucket into the stack, or deploy with --context backupBucketName=<a new name>.
    produces A deploy that gets past the BucketAlreadyOwnedByYou failure without losing the bundles.
    verify   aws s3 ls s3://diveday-backups/exports/ — the existing bundles are still listed.
    note     Deleting the bucket to make a deploy go green deletes production backups. That is the trade RETAIN exists to force; do not take it by reflex.
```

## Verification

```text
[15] Confirm the surplus access keys were revoked
    when     after the first deploy, and after any deploy that adds an IAM identity
    why      The stack revokes them itself (infra-stack.ts §13), but this is the one automation whose failure is invisible until it matters. IAM allows two access keys per user, hard and not adjustable; the keys minted by hand before this stack existed are not CloudFormation's to delete. If any survive, the identity is at the ceiling and the NEXT rotation fails with LimitExceeded — on the day someone is rotating because something leaked.
    run      Read the RetiredAccessKeys stack output: the keys this deploy revoked, or 'none'.
             for u in reg-suit-bot cdk-deployer diveday-mcp-readonly-local diveday-mcp-readonly-cloud diveday-ses-sender diveday-sns-sms-sender diveday-backup-uploader diveday-places-lookup; do echo "== $u"; aws iam list-access-keys --user-name "$u" --query 'AccessKeyMetadata[].AccessKeyId' --output text; done
    verify   Every identity lists exactly one access key.
    if not   A user with two means the pruner did not run or could not reach it — check the diveday-access-key-pruner log group. Deleting the older key by hand is safe and restores the invariant: aws iam delete-access-key --user-name <user> --access-key-id <older-id>
    note     It never touches a user holding fewer than two keys, so it cannot leave an identity with none, and it keeps the newest — which is always the one CloudFormation just created.

[16] Confirm both SNS webhook subscriptions
    when     after every deploy that created or replaced a subscription
    why      An HTTPS subscription is only real once the endpoint answers SNS's handshake, and both routes answer 503 until their topic ARN is in the app's environment. On a fresh environment the stack therefore creates a subscription the app cannot yet confirm, and SNS deletes it after roughly three days. Nothing else detects this: every hop either side reads healthy while no event ever arrives.
    run      aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn>
             aws sns list-subscriptions-by-topic --topic-arn <SmsDeliveryReceiptsTopicArn>
    verify   Both list a real SubscriptionArn, not "PendingConfirmation".
    if not   "PendingConfirmation" means the endpoint answered non-2xx — SES_SNS_TOPIC_ARN or SMS_SNS_TOPIC_ARN is missing from the running app. Set it, redeploy the app, then `aws sns unsubscribe --subscription-arn <pending>` and redeploy this stack to re-issue the handshake. Redeploying this stack alone will not fix it: CloudFormation still believes the subscription exists.

[17] Confirm SMS delivery-status logging applied
    when     after the first deploy, and after changing the delivery-status role
    why      infra-stack.ts §10 sets this through an AwsCustomResource because SetSMSAttributes is account-level state with no CloudFormation resource. A custom resource that succeeded is not the same as an attribute that took.
    run      aws sns get-sms-attributes --attributes DeliveryStatusIAMRole,DeliveryStatusSuccessSamplingRate
    verify   The diveday-sns-sms-delivery-status role ARN, and a sampling rate of 100.
```
