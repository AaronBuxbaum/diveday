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
```

## AWS account

```text
[4] Request SES production access
    when     once, before sending to anyone who has not verified their address
    why      A human-reviewed AWS Support case. There is no API.
    run      SES console -> Account dashboard -> Request production access.
    produces Sending to arbitrary recipients. Until then SES is in the sandbox: pre-verified addresses and the mailbox simulator only.
    verify   aws sesv2 get-account --query ProductionAccessEnabled

[5] Leave the SMS sandbox, raise the spend limit, register an origination identity
    when     once, before sending SMS to a diver
    why      All three are account-level SMS state. The sandbox exit and any spend limit above $1 are Support cases; a US origination identity (10DLC or toll-free) is a vetted registration with the carriers. The SetSMSAttributes custom resource (infra-stack.ts §10) deliberately touches none of them -- it sets delivery-status logging and nothing else.
    run      SNS console -> Text messaging (SMS) -> Exit SMS sandbox (a Support case).
             Service Quotas -> Amazon SNS -> Account spend threshold for SMS (default $1/month).
             SNS console -> Text messaging (SMS) -> Origination identities, for US traffic.
    verify   aws sns get-sms-attributes --attributes MonthlySpendLimit
    note     Skipping this does not fail anything visibly: the pipeline reads healthy end to end while sends are capped or dropped.
```
