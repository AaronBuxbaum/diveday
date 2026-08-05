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

**4. No *additional* principal is granted read access to it**, and the claim is stated at exactly
that strength rather than the more comfortable one.

The two read-only MCP users carry an explicit `Deny` on `secretsmanager:GetSecretValue` for every
secret, so *that* half holds regardless of what AWS adds to `ReadOnlyAccess` next.

`cdk-deployer` is **not** bounded, and an earlier draft of this record said it was. It can assume
`cdk-<qualifier>-deploy-role`, which passes a CloudFormation execution role that a plain
`cdk bootstrap` leaves at `AdministratorAccess` — `--cloudformation-execution-policies` defaults to
empty, and `pnpm infra:bootstrap` passes nothing. A holder of the deployer key can therefore deploy a
one-resource stack that reads the secret; withholding `grantRead` costs a step, not the capability.
Two things follow: the deployer's own key is marked **workstation-only** in the document and in
`.env.example`, because it is the key that yields all the others; and bounding it for real is a
bootstrap-time act, noted on the `cdk-bootstrap` manual action and not done today.

The account owner reads the secret with an administrator profile or in the console.

**5. Rotation is a deploy, driven by a CloudFormation parameter.** `Serial` may only ever be
incremented and forces create-then-delete replacement, so the user is transiently at IAM's two-key
ceiling and never below one working key:

```bash
pnpm infra:deploy --parameters CredentialSerial=2
```

**A parameter, not `--context`, is the safety property.** Context is per-invocation: a rotation done
with context is undone by the next deploy that omits the flag, which would replace all eight keys and
delete the freshly-placed ones with nothing connecting the outage to the deploy. CloudFormation
remembers a parameter, and `cdk deploy` defaults `--previous-parameters` to `true`, so forgetting the
flag is a no-op. One serial covers all eight: they leave in one document and land in the same four
places, so partial rotation saves little and eight parameters would be eight more things to track.

**6. The stack revokes the access keys it did not create.** IAM allows two keys per user, hard and
not adjustable, and seven of these identities had theirs made by hand — invisible to CloudFormation
and undeleted by it. The deploy that adds a managed key leaves each such user at the ceiling, so the
*next* rotation fails with `LimitExceeded`, on the day someone is rotating because something leaked.
A Lambda-backed custom resource retires the surplus, keeping the newest key per user.

This was a numbered manual step for one draft. A manual step is the wrong shape for it: the whole
hazard is that nobody knows it is armed, and a checklist entry that must be executed correctly *once*
before a future emergency works is not a control. Automating it is also what makes "revoke and
re-create" a usable answer to an exposure rather than a procedure whose first attempt fails.

Three properties keep a destructive automation safe: it never touches a user holding fewer than two
keys (so it cannot leave an identity with none); it keeps the newest, which the resource's dependency
on all eight keys guarantees is CloudFormation's; and its IAM policy names the eight user ARNs, so it
cannot reach a key it does not own. It is deliberately **not** re-invoked by a rotation — its
properties name the users, not the key ids — because that would race CloudFormation's own cleanup
delete of the outgoing key, for no gain once every user holds exactly one.

**7. Every remaining manual step is a `ManualAction` record** (`infra/lib/manual-actions.ts`) that
must state **when** it applies, **why** the stack cannot do it, **what** to run, and **where** the
result goes. The record type is the enforcement: a step with no stated destination cannot be
written. The registry renders to grouped `CfnOutput`s printed after every deploy *and* to the
generated [docs/engineering/manual-actions.md](../../engineering/manual-actions.md), asserted equal
by a test. Seventeen actions, including every step listed as missing above.

**8. `infra/` gets test coverage.** `vitest.config.ts` now includes `infra/**/*.test.ts`. Lint and
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
- **A `--context` value for the rotation serial.** Rejected after review: context is not remembered
  between deploys, so the *next* deploy run without the flag re-synthesizes `Serial: 1`, replaces all
  eight keys, and deletes the ones just placed — production email and SMS failing on
  `InvalidClientTokenId` with nothing tying it to the deploy. A CloudFormation parameter is
  remembered (`cdk deploy --previous-parameters` defaults true), so omission is a no-op. The cost is
  losing per-identity serials, which is acceptable because the credentials already travel together.
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

- **The reg-suit key will very likely be replaced on the first deploy, and CI must be re-pasted.**
  An earlier draft of this record claimed the opposite, reasoning that "`Serial` may only be
  incremented, so adding `Serial: 1` is a no-op". That conflates AWS's *semantic* rule with
  CloudFormation's *diff* behaviour: CFN decides update actions by comparing template properties, a
  previously-absent property is a change, and `AWS::IAM::AccessKey.Serial` is `Update requires:
  Replacement`. Keeping the L1 `CfnAccessKey` still matters — it preserves the logical id, so the key
  is replaced at most once rather than also being replaced by a construct-hash change — but **run
  `pnpm infra:diff` before the first deploy and read the `AWS::IAM::AccessKey` line**, and treat the
  `credentials-to-github-actions` action as required immediately after it. The failure if you skip
  it is quiet: per ADR 20260729 a baseline-lookup failure degrades to "no baseline" rather than
  stopping, so visual regression would simply stop protecting anything.
- **Seven new access keys appear on the first deploy** and land in the secret. Nothing consumes them
  until a human places them, so the deploy is inert for the app.

- **The first deploy revokes your current `cdk-deployer` key.** It is one of the hand-minted keys
  decision 6 retires. The deploy itself completes — it runs under an assumed bootstrap role, not that
  key — but the next `pnpm infra:deploy` fails until the new deployer credentials are pasted out of
  the secret, read with the administrator profile. If the deploy rolls back *after* the revocation,
  the deployer is left with no key at all and the admin profile is the way back in. Accepted
  deliberately: the alternative is leaving every identity one key short of a working rotation.
- **Deleting an IAM user's construct now deletes its key**, breaking anything still holding it, where
  a hand-minted key survived untouched. That is the correct default and it is a sharp edge; the
  runbook says so.
- **Forgetting the rotation flag is safe.** This was the design's weakest point while the serial
  was a context value, and moving it to a CloudFormation parameter removes it: the deployed value
  persists, so an unrelated later deploy cannot silently rotate and delete eight live credentials.
  The residual cost is that per-identity rotation is gone — rotating one rotates all — and that
  `--no-previous-parameters` or a different pipeline would reapply the default.
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
  deploy **must** be preceded by `pnpm infra:diff`, both for the reg-suit replacement above and
  because it will prompt for IAM approval anyway.

- **The one guard that enforces decision 4 scans four resource types**, not just
  `AWS::IAM::Policy`: a later `secret.addToResourcePolicy(...)` synthesizes an
  `AWS::SecretsManager::ResourcePolicy` that an IAM-only scan would never look at, which would leave
  this record's central claim asserted by a test structurally unable to see it being violated.
- **Known unfixed, deliberately out of scope:** `reg-suit-bot` still carries
  `s3:PutObjectAcl`/`s3:GetObjectAcl` that `regconfig.json`'s `enableACL: false` means nothing uses,
  and the VRT bucket is unversioned. Both are real least-privilege improvements and neither is
  verifiable without a deploy that exercises the visual pipeline.
