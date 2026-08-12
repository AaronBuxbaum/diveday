# 20260812-diff-role-assumes-file-publishing-role — Grant `GitHubActionsCdkDiffRole` `sts:AssumeRole` on the CDK bootstrap file-publishing role, and nothing else

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amends:** [20260808-github-actions-cdk-diff-deploy](20260808-github-actions-cdk-diff-deploy.md) —
  its Decision describes `GitHubActionsCdkDiffRole`'s permissions as `cloudformation:{DescribeStacks,
  GetTemplate,CreateChangeSet,DescribeChangeSet,DeleteChangeSet}` and one SSM read, "nothing else."
  That's amended to add exactly one more grant, described below; the role's Deny-everything-else
  posture (no secret reads, no deploy-role assumption) is unchanged.

## Context

Once [20260812-github-oidc-sub-embeds-immutable-ids](20260812-github-oidc-sub-embeds-immutable-ids.md)
let `GitHubActionsCdkDiffRole` actually assume its role via OIDC for the first time, `cdk diff` failed
a step further in, on something that had been invisible until then:

```
current credentials could not be used to assume 'arn:aws:iam::417160702652:role/cdk-hnb659fds-file-publishing-role-417160702652-us-east-1', but are for the right account. Proceeding anyway.
fail: Bucket named 'cdk-hnb659fds-assets-417160702652-us-east-1' exists, but we dont have access to it.
Could not create a change set, will base the diff on template differences
There were no differences
```

`cdk diff` always publishes the stack template as an S3 asset before comparing it — this stack's
synthesized template is well past CloudFormation's 51,200-byte inline limit — and that publish step
needs the bootstrap `file-publishing-role`. Reading that role's trust policy (`aws iam get-role
--role-name cdk-hnb659fds-file-publishing-role-417160702652-us-east-1
--query 'Role.AssumeRolePolicyDocument'`) shows the standard CDK bootstrap default: `Principal: {"AWS":
"arn:aws:iam::417160702652:root"}`. That's the broadest trust CDK bootstrap offers — it delegates the
actual decision to the account's own IAM. For **same-account** role assumption specifically, AWS
requires grants on both sides: the target's trust (resource) policy, already satisfied here, *and* the
calling principal's own identity-based policy explicitly allowing `sts:AssumeRole` on that role's ARN.
`GitHubActionsCdkDiffRole` never had that grant — hence the failure, invisible until the OIDC fix let
this role's requests reach AWS at all. `GitHubActionsCdkDeployRole` already carries this same style of
grant across all four bootstrap roles (§18's `AssumeCdkBootstrapRoles` statement), which is why deploy
was never seen hitting this — it just hadn't been exercised yet either, for the same OIDC reason.

Confirmed as the missing piece and not something else: a local root-authenticated `cdk diff` hit the
identical failure shape, on a session whose STS identity doesn't need an identity-based policy grant
at all — so this is a distinct, likely-unrelated local/root oddity, tracked in the follow-up filed
alongside this record's investigation and not blocking this specific fix, which is scoped to the CI
role.

## Decision

`GitHubActionsCdkDiffRole` gets one new statement, `AssumeCdkFilePublishingRole`: `sts:AssumeRole` on
`bootstrapRoleArn("file-publishing-role")` and nothing else. Not the other three bootstrap roles
`GitHubActionsCdkDeployRole` holds:

- **Not `lookup-role`** — this stack does no context lookups (no `Vpc.fromLookup`, no
  `StringParameter.valueFromLookup`), so it's unused scope.
- **Not `image-publishing-role`** — this stack publishes no container images (no
  `DockerImageAsset`/`ContainerImage.fromAsset`), same reasoning.
- **Not `deploy-role`, deliberately** — that's the one grant that would let this role actually execute
  a change, which is exactly the boundary 20260808 drew ("can create and discard a change set, never
  executes one") and this record doesn't touch. `GitHubActionsCdkDiffRole` is assumable by any branch's
  `pull_request` run in a public repo; the smallest grant that makes `cdk diff` actually work is the
  only one that belongs on a role with that reach.

## Alternatives considered

- **Grant the same four-role `AssumeCdkBootstrapRoles` statement `GitHubActionsCdkDeployRole` already
  has.** Rejected: three of the four grants would be dead scope on a broadly-reachable role, for
  symmetry with a role whose job is different on purpose.
- **Investigate and fix the bootstrap stack's trust policy instead**, on the theory that re-running
  `cdk bootstrap` with different `--trust`/`--trust-for-lookup` flags might be the "real" fix. Rejected
  once the trust policy was actually read: it already trusts the account root, which is the broadest
  trust CDK bootstrap supports — nothing about `--trust` flags would change same-account identity-policy
  requirements, which is the actual gate. Re-bootstrapping would not have fixed this.
- **Do nothing and accept the degraded template-only diff.** Rejected: that fallback silently reported
  "no differences" for a change ([20260812-github-oidc-sub-embeds-immutable-ids](20260812-github-oidc-sub-embeds-immutable-ids.md))
  that plainly rewrites both roles' `AssumeRolePolicyDocument` — a reviewer reading that comment on a
  future `infra/`-touching PR would be told nothing changed when something did.

## Consequences

`cdk diff` in CI can now build a real CloudFormation change set instead of falling back to a
template-only comparison, so the diff comment posted to a `pull_request` (and a `workflow_dispatch`
run's own diff output) reflects what would actually happen, not just what changed textually.

`GitHubActionsCdkDiffRole` can now assume one more role than before. Still cannot assume `deploy-role`,
so still cannot create, modify, or delete any resource this stack manages, and still cannot read any
Secrets Manager secret through its own identity policy — but that Deny doesn't travel across an
`sts:AssumeRole` boundary: an assumed-role session's permissions come entirely from the *target* role's
own policy, not an intersection with the caller's. What actually keeps this grant from reaching a
secret is that `file-publishing-role`'s attached policy (`FilePublishingRoleDefaultPolicy` in AWS's
own CDK bootstrap template, verified by reading it directly rather than assuming) carries only S3
(`GetObject*`/`GetBucket*`/`List*`/`DeleteObject*`/`PutObject*`/`Abort*`/`GetEncryptionConfiguration`)
on the bootstrap staging bucket and KMS (`Decrypt`/`DescribeKey`/`Encrypt`/`ReEncrypt*`/
`GenerateDataKey*`) on its key — no `secretsmanager:*`, no `cloudformation:*`, no `iam:PassRole`. (ECR
belongs to a *different* bootstrap role, `image-publishing-role`, not granted here — an earlier draft
of this record misattributed it to `file-publishing-role`.) If a future CDK bootstrap template version
ever widened that policy, this grant would inherit the change silently; the boundary here is AWS's
bootstrap template, not anything this stack owns or tests.

That S3 grant is also **bucket-wide**, not scoped to this stack's own template object: `sts:AssumeRole`
hands over the whole target policy, and `file-publishing-role`'s resource is the entire per-(account,
region) staging bucket, `${StagingBucket.Arn}` and `${StagingBucket.Arn}/*`. Today that's low-impact —
grepping `infra/` turns up no `fromAsset`/`NodejsFunction`/`DockerImageAsset` (both this stack's Lambdas
use `Code.fromInline`) and no context lookups, so nothing but this stack's own oversized template
object lives in that bucket for this role to reach. But the grant itself doesn't know that: the moment
this stack (or any other CDK app sharing this account) gains a bundled Lambda or another file asset, it
lands in the same shared bucket and becomes listable, readable, overwritable, and deletable through this
identical grant, assumable by any branch's `pull_request` run including a fork's, with no change to this
file required. Revisit this record if that happens — the fix then is narrowing what's actually needed
(a bucket-prefix condition, if CDK's staging-bucket layout permits one) rather than accepting the
wider surface by default.

Escape hatch: if this stack ever needs a real `Vpc.fromLookup`/`StringParameter.valueFromLookup` or a
container image asset, `lookup-role`/`image-publishing-role` would need the same one-line addition
`file-publishing-role` got here — worth revisiting this record's "not" list at that point rather than
adding preemptively now.

## Follow-up

- The local-root-session variant of this failure (same "could not assume... proceeding anyway" +
  "we dont have access to it" shape, but from `arn:aws:iam::417160702652:root`, which shouldn't need an
  identity-based policy grant at all) is unexplained by this record's fix and is a separate question —
  worth a `-v` CDK run to see the underlying error rather than guessing further.
- Nothing in this repo's tests asserts `GitHubActionsCdkDiffRole`'s new `sts:AssumeRole` statement is
  scoped to exactly `file-publishing-role`. A copy-paste from `GitHubActionsCdkDeployRole`'s four-role
  `AssumeCdkBootstrapRoles` array onto this fork-reachable role — reintroducing `deploy-role` in
  particular — would pass `cdk synth` silently. `infra/lib/manual-actions.test.ts` gets a new assertion
  for this in the same change that adds the grant.
