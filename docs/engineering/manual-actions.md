# Manual actions

> [!NOTE]
> Generated from the registry in [infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts).
> Do not edit by hand — run `pnpm test infra -u` to regenerate after changing the registry.

Only account approvals that no CLI can perform belong here. After a successful deploy,
`pnpm infra:deploy` writes the env files and offers Vercel, GitHub, and SES DNS handoffs
as simple yes/no questions.

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
    why      CDK deploys through four roles that a bootstrap stack provisions. §5's deployer holds sts:AssumeRole on exactly those four ARNs and nothing else, so without them it can deploy nothing. The wrapper opens aws login if needed, reads the signed-in profile's AWS account, asks you to confirm it, then sets the account-level S3 public-access configuration the visual-report bucket needs.
    run      pnpm infra:bootstrap
    produces The cdk-<qualifier>-{deploy,file-publishing,image-publishing,lookup}-role roles.
    verify   aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version
             aws s3control get-public-access-block --account-id <12-digit-account-id> --query PublicAccessBlockConfiguration
    note     The wrapper requires you to type the resolved account id; in a non-interactive terminal pass --confirm-account <12-digit-account-id>. It does not require a root-user credential: programmatic root credentials are a security regression. The account-level Block Public Access change permits public buckets but does not itself make any bucket public; an AWS Organizations policy can still prohibit it. If you bootstrap with --qualifier, infra-stack.ts §5 builds the four role ARNs from the @aws-cdk/core:bootstrapQualifier context value -- set it to match, or the deployer's AssumeRole silently matches nothing. --cloudformation-execution-policies defaults to empty, so pass scoped policies here to avoid an administrator-equivalent deployer credential.

[3] Enable Cost Explorer
    when     once per account
    why      The Cost Anomaly Detection monitor (infra-stack.ts §7) depends on Cost Explorer, which is a one-time console opt-in with no API, and produces no findings until it has accumulated spend history. The AWS::Budgets::Budget alongside it needs nothing.
    run      Billing and Cost Management console -> Cost Explorer -> enable.
    verify   aws ce get-anomaly-monitors --query 'AnomalyMonitors[].MonitorName'

[4] Set a spend cap or usage alert in the Vercel, Neon, and Sentry consoles
    when     once per provider account, and again after changing plan
    why      AWS Budgets (infra-stack.ts §7) can only see the AWS bill, which is the smallest one DiveDay pays. Vercel, Neon, and Sentry each bill on their own console with their own limits, and none of them exposes an API for setting one. The in-app monitor (src/app/api/cron/usage) polls usage and emails; it deliberately cannot stop spending, so the vendor-side cap is the only hard stop that exists.
    run      Vercel -> Settings -> Billing -> Spend Management: set an amount and an email notification.
             Neon -> Organization -> Billing: set the plan's usage alert, and confirm whether exceeding it suspends compute or bills overage on your plan.
             Sentry -> Settings -> Subscription -> Usage: set a spend cap and per-category quota alerts.
    produces A vendor-side notification that arrives even when the in-app monitor is not running, and, where the provider offers one, an actual ceiling.
    note     Neon is the one whose overflow can take DiveDay down rather than cost money: on the free plan an exhausted compute allowance suspends the endpoint. Record which behaviour your plan has in docs/engineering/cost-guardrails-runbook.md.
```

## Credentials

```text
[5] Mint the Vercel and Neon usage read tokens
    when     once, before the usage monitor can measure anything, and again after rotating either
    why      Both are another vendor's account credentials -- this stack has no identity on either platform and no API that could mint one. Nothing else in DiveDay needs them, so they exist only for the daily usage poll.
    run      Vercel -> Account Settings -> Tokens -> Create: scope it to the team that holds the billing account, read access only.
             Neon -> Organization -> API keys -> Create: an organization key, not a personal one, so the consumption endpoint can report every project.
    produces The four values GET /api/cron/usage needs in order to report a number instead of not_configured.
    store    USAGE_VERCEL_TOKEN and USAGE_VERCEL_TEAM_ID (team_...), USAGE_NEON_API_KEY and USAGE_NEON_ORG_ID (org-...), in .env.local for a local run and in Vercel Production for the deployment. Each pair is all-or-nothing: a token with no id reads as not configured.
    note     Absent is a supported state and the monitor says so out loud -- the affected ceiling reports not_configured, which is deliberately never rendered as ok. The USAGE_ prefix is not cosmetic: VERCEL_ is the namespace Vercel injects its own system variables into.
```

## AWS account

```text
[6] Request SES production access
    when     once, before sending to anyone who has not verified their address
    why      A human-reviewed AWS Support case. There is no API.
    run      SES console -> Account dashboard -> Request production access.
    produces Sending to arbitrary recipients. Until then SES is in the sandbox: pre-verified addresses and the mailbox simulator only.
    verify   aws sesv2 get-account --query ProductionAccessEnabled

[7] Leave the SMS sandbox, raise the spend limit, register an origination identity
    when     once, before sending SMS to a diver
    why      All three are account-level SMS state. The sandbox exit and any spend limit above $1 are Support cases; a US origination identity (10DLC or toll-free) is a vetted registration with the carriers. The SetSMSAttributes custom resource (infra-stack.ts §10) deliberately touches none of them -- it sets delivery-status logging and nothing else.
    run      SNS console -> Text messaging (SMS) -> Exit SMS sandbox (a Support case).
             Service Quotas -> Amazon SNS -> Account spend threshold for SMS (default $1/month).
             SNS console -> Text messaging (SMS) -> Origination identities, for US traffic.
    verify   aws sns get-sms-attributes --attributes MonthlySpendLimit
    note     Skipping this does not fail anything visibly: the pipeline reads healthy end to end while sends are capped or dropped.
```

## Verification

```text
[8] Confirm the usage monitor reports numbers and reaches a real inbox
    when     after minting the tokens, and after changing OPS_ALERT_EMAIL
    why      Every failure mode of this monitor is silent by construction. A wrong token, a revoked scope, a renamed provider field, or an unreachable alert mailbox all leave a cron that runs green and reports nothing, which is indistinguishable from a month with no cost problem.
    run      curl -s -H "Authorization: Bearer $CRON_SECRET" <webhookHost>/api/cron/usage | jq '.evaluations[] | {ceilingId, level, value}'
             Compare the vercel_spend and neon_* figures against the two consoles once, by eye.
    verify   Every polled ceiling reports ok/warn/over with a number. A level of not_configured means the token pair is missing; unavailable means it is present and the read failed.
    if not   unavailable carries a reason code (unauthorized, forbidden, no_charge_rows, metric_absent, unrecognised_shape) -- read it from the response or from cron_usage.scan_complete in the log drain, then see docs/engineering/cost-guardrails-runbook.md. Do not treat a quiet monitor as a healthy one.
```
