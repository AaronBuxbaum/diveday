# 20260805-cdk-minted-credentials-and-manual-actions — Mint every access key in CDK, hand it over as a filled-in `.env.example`, and give every remaining manual step one shape

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`infra/lib/infra-stack.ts` held two incompatible credential postures at once and documented only one.

Seven of its eight IAM users minted access keys out of band, each with a `*AccessKeyInstructions`
`CfnOutput` printing `aws iam create-access-key --user-name …`. The eighth, `reg-suit-bot`, used
`CfnAccessKey` and published its secret access key as an **unmasked `IAMUserSecretKey` output**.
Because the stack's own comment and
[infrastructure-runbook.md](../../engineering/infrastructure-runbook.md) both asserted the
out-of-band posture as universal ("every IAM user in this stack mints its key out of band for that
reason"), the exception was invisible to anyone reading either.

That was not a documentation nit. `cloudformation:DescribeStacks` resolves outputs to plaintext, and
three identities hold it:

- `cdk-deployer`, whose entire stated rationale is that a leaked deploy credential "stays bounded by
  those roles instead of by AdministratorAccess" — it has `DescribeStacks` on `stack/*/*`;
- both `diveday-mcp-readonly-*` users, whose comment claims "no write or delete action exists on
  these credentials at all", and whose `ReadOnlyAccess` policy includes `DescribeStacks`.

`bucket.grantReadWrite(user)` resolves to `s3:DeleteObject*`, and the visual-regression bucket is
unversioned. So all three identities could read a credential that destroys every visual baseline,
defeating the security rationale of each of them simultaneously.

The seven instruction outputs were inconsistent in a second, quieter way: they named their
destination in five different registers — a glob (`SES_*`), a mechanism with no name ("a named AWS
CLI profile"), "that runner's secret settings" for a runner that does not exist, and in
`cdk-deployer`'s case nothing at all. Not one named the literal environment variables it becomes.

The `ManualActionItems` output was presented as the complete remainder and was one provider's
remainder: five SES steps. Missing were six of the seven credential hand-offs, thirteen-plus
environment variables, the SNS SMS sandbox / spend-limit / origination gate, the account-level S3
Block Public Access toggle the public VRT bucket depends on, Cost Explorer enablement, backup-bucket
re-adoption, and key rotation for every identity. Its item 5 also told an operator that a pending SMS
subscription was caused by a step that could not fix it, because the step listed only `SES_*`
variables while `/api/webhooks/sms` 503s on `SMS_SNS_TOPIC_ARN`.

## Decision

**1. CloudFormation mints every access key.** All eight identities get an `AWS::IAM::AccessKey` with
a `Serial`. The old objection — "`CfnAccessKey` would put the secret in the CloudFormation template
and stack state" — is wrong about the template: `cloudformation:GetTemplate` returns the unresolved
`Fn::GetAtt` at both `Original` and `Processed` stages. **`CfnOutput` was the hole, not
`CfnAccessKey`.** Minting by hand never avoided the secret either; it moved it into a terminal
scrollback, once, unrecoverably.

**2. No `CfnOutput` ever carries key material again.** `IAMUserAccessKey` and `IAMUserSecretKey` are
deleted. `infra/lib/manual-actions.test.ts` fails the build if a resolved `SecretAccessKey` reaches
any output.

**3. One Secrets Manager secret, `diveday/env`, whose value is `.env.example` with the values filled
in.** Generated from `.env.example` at synth time, so the two cannot drift: a renamed variable
renames itself in the secret, and a value the stack supplies for a key `.env.example` no longer
declares **throws during synth**. Credentials whose destination is not a dotenv file (the two MCP
users, the backup uploader) ride at the bottom in a commented section under the destination they
belong to, so pasting the whole document into `.env.local` stays safe.

**4. Nothing in the stack is granted read access to it.** Not `cdk-deployer`. The two read-only MCP
users carry an explicit `Deny` on `secretsmanager:GetSecretValue` for every secret, so the claim
holds regardless of what AWS adds to `ReadOnlyAccess` next. The account owner reads it with an
administrator profile or in the console.

**5. Rotation is a deploy.** `Serial` may only ever be incremented and forces create-then-delete
replacement, so the user is transiently at IAM's two-key ceiling and never below one working key:

```bash
pnpm infra:deploy --context credentialSerial=2                         # every key
pnpm infra:deploy --context credentialSerial:diveday-ses-sender=2      # one key
```

**6. Every remaining manual step is a `ManualAction` record** (`infra/lib/manual-actions.ts`) that
must state **when** it applies, **why** the stack cannot do it, **what** to run, and **where** the
result goes. The record type is the enforcement: a step with no stated destination cannot be
written. The registry renders to grouped `CfnOutput`s printed after every deploy *and* to the
generated [docs/engineering/manual-actions.md](../../engineering/manual-actions.md), asserted equal
by a test. Sixteen actions, including every step listed as missing above.

**7. `infra/` gets test coverage.** `vitest.config.ts` now includes `infra/**/*.test.ts`. Lint and
`tsc` see TypeScript; only a synth sees a CloudFormation template, and a leaked credential is a
property of the template.

## Alternatives considered

- **One secret per credential (8 × $0.40 = $3.20/month).** The cleaner design — independent rotation,
  independent read scoping, and each secret's JSON keys could be exactly the destination variable
  names. Rejected on cost: [20260802-aws-cost-guardrails](20260802-aws-cost-guardrails.md) budgets
  ~$5/month for this account, so a $3.20 fixed floor would fire the budget's 50% and 80% alerts every
  month on fixed cost and turn the guardrail into noise. Aaron chose the consolidated secret
  explicitly. Revisit if the account's baseline spend ever makes $3.20 immaterial.
- **A flat JSON secret keyed by destination variable name.** Rejected: four of the eight identities
  land on a bare `AWS_ACCESS_KEY_ID` (`cdk-deployer`, both MCP users, and reg-suit before it grew its
  `REG_SUIT_` prefix), so a flat map collides. Nesting per identity solves the collision but is a
  shape someone has to transcribe field by field — which is the problem `.env.example` form removes.
- **SSM Parameter Store `SecureString` (free at rest, KMS-encrypted).** Rejected as impossible, not
  merely unattractive: `AWS::SSM::Parameter`'s `Type` allows only `String | StringList` — CDK will
  synthesize `SecureString` and the deploy is rejected server-side. It would take a Lambda-backed
  custom resource, which is more machinery than the $0.40 it saves.
- **A customer-managed KMS key for the secret.** Rejected: $1/month against a $5 budget for
  key-policy-level access control that a single-operator account does not use. The default
  `aws/secretsmanager` key is free and every principal in the account can already use it, which is
  why the `Deny` in decision 4 is the thing doing the work.
- **Keeping the out-of-band minting and just fixing the reg-suit exception.** Rejected: it preserves
  the failure mode where a credential exists only in a scrollback, leaves rotation as a code change
  nobody makes, and keeps eight instruction outputs whose text is the only thing holding the
  destination — the exact drift this record exists to remove.
- **`secretObjectValue` rather than `SecretValue.unsafePlainText`.** `secretObjectValue` is the
  documented JSON path and renders a flat object; the destination format here is dotenv, and the
  document is a string. `unsafePlainText` is the intended escape hatch for a value assembled from
  references — CDK resolves the embedded tokens into an `Fn::Join`, and no plaintext credential
  exists in this repo or the template.
- **One `CfnOutput` per manual action.** Rejected: sixteen keys would bury the rest of the deploy
  summary. Grouped by category instead, chunked automatically when a group would cross
  CloudFormation's 4096-character output-value ceiling — which the Credentials group did on the first
  attempt, caught by the test rather than by a failed deploy.

## Consequences

- **The reg-suit key rotates on the next deploy is *not* a consequence** — `RegSuitUserAccessKey`
  keeps its logical id (which is why the L1 `CfnAccessKey` is used rather than the L2 `AccessKey`,
  whose logical id carries a construct hash), so CI's current credential survives. Adding `Serial: 1`
  to an existing key is a no-op; CloudFormation replaces only when it increases.
- **Seven new access keys appear on the first deploy** and land in the secret. Nothing consumes them
  until a human places them, so the deploy is inert for the app.
- **Deleting an IAM user's construct now deletes its key**, breaking anything still holding it, where
  a hand-minted key survived untouched. That is the correct default and it is a sharp edge; the
  runbook says so.
- **`Serial` is not persisted between deploys.** Passing `--context credentialSerial=2` once and
  omitting it next time rotates the key *back*. The runbook carries the current value (1) and must be
  updated when it changes. This is the weakest part of the design; the alternative — writing the
  serial into the repo — makes rotation a commit, which is worse.
- **`.env.example` is now load-bearing for the infrastructure.** Editing it changes the secret's
  contents on the next deploy, and removing a key the stack fills breaks `cdk synth` with a message
  naming the key. That coupling is deliberate and is what "stays in sync" means here.
- **A recurring $0.40/month.** Named in the runbook next to the `monthlyBudgetLimit` default so the
  next person to add a secret moves the limit with it.
- **`pnpm check` is slower by one CDK synth** (~4s), and `infra/` now has 13 assertions where it had
  none.
- **Still unverified against real AWS.** `pnpm infra:synth` succeeds and the template was inspected —
  the secret renders as an `Fn::Join` over `Fn::GetAtt` intrinsics with no plaintext, and every
  minted key appears in it — but no deploy has run. Same caveat as
  [20260803-webhook-subscriptions-in-cdk](20260803-webhook-subscriptions-in-cdk.md). The first real
  deploy should be preceded by `pnpm infra:diff` and will prompt for IAM approval.
- **Known unfixed, deliberately out of scope:** `reg-suit-bot` still carries
  `s3:PutObjectAcl`/`s3:GetObjectAcl` that `regconfig.json`'s `enableACL: false` means nothing uses,
  and the VRT bucket is unversioned. Both are real least-privilege improvements and neither is
  verifiable without a deploy that exercises the visual pipeline.
