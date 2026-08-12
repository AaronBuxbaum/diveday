# FU-20260812-diff-role-cannot-reach-cdk-assets-bucket — Give the CI diff path a real CloudFormation change set instead of a degraded template-only diff

- **Status:** Open
- **Raised:** 2026-08-12 — PR #480, the first time `GitHubActionsCdkDiffRole` (or a local root
  session, see below) actually got past `sts:AssumeRoleWithWebIdentity` far enough to reach `cdk
  diff`'s asset-publishing step
- **Kind:** risk
- **Effort:** M
- **Touches:** `infra/lib/infra-stack.ts` — §18's diff-role policy; possibly the CDK bootstrap
  stack's trust policy, which lives outside this repo (a separate, AWS-managed `CDKToolkit` stack)

## What I noticed

With the OIDC trust-condition fix in PR #480 deployed, `GitHubActionsCdkDiffRole` can finally
assume its role via OIDC — confirmed via a live `workflow_dispatch` run
(https://github.com/AaronBuxbaum/diveday/actions/runs/31559377767/job/93998377331). But the `cdk
diff` step inside that job then hits a second, separate failure:

```
current credentials could not be used to assume 'arn:aws:iam::417160702652:role/cdk-hnb659fds-lookup-role-417160702652-us-east-1', but are for the right account. Proceeding anyway.
current credentials could not be used to assume 'arn:aws:iam::417160702652:role/cdk-hnb659fds-deploy-role-417160702652-us-east-1', but are for the right account. Proceeding anyway.
current credentials could not be used to assume 'arn:aws:iam::417160702652:role/cdk-hnb659fds-file-publishing-role-417160702652-us-east-1', but are for the right account. Proceeding anyway.
fail: Bucket named 'cdk-hnb659fds-assets-417160702652-us-east-1' exists, but we dont have access to it.
Could not create a change set, will base the diff on template differences (run again with -v to see the reason)
Stack DiveDay (diveday-infra)
There were no differences (CDK metadata changes were hidden, run cdk diff --strict to show)
```

That "no differences" result is wrong on its face: PR #480 changes both IAM roles'
`AssumeRolePolicyDocument`, which is exactly the kind of change a real diff would show. The
degraded, no-change-set fallback path CDK uses when it can't publish the template to S3 just isn't
comparing the same thing a real `cdk diff` does.

The same failure shape showed up in a **local** `pnpm infra:deploy`/`cdk diff` run authenticated as
the AWS account root user (`arn:aws:iam::417160702652:root`, confirmed via `aws sts
get-caller-identity` earlier the same day) — so this isn't specific to the GitHub Actions role;
neither root nor `GitHubActionsCdkDiffRole` can assume the CDK bootstrap's `lookup-role`,
`deploy-role`, or `file-publishing-role`, and neither has direct S3 access to the assets bucket
either.

## Why it isn't already done

Two things this session couldn't do:

1. **No AWS console/IAM access from this sandbox** to inspect the CDK bootstrap stack's actual
   role trust policies or the assets bucket policy — this repo's CDK app (`infra/lib/infra-stack.ts`)
   doesn't define the bootstrap stack at all; it's a separate, AWS CDK-managed stack
   (`CDKToolkit`, qualifier `hnb659fds`) created once via `cdk bootstrap`, outside this repo's
   source.
2. **This is IAM-permissions surface** — granting `GitHubActionsCdkDiffRole` (or whatever identity
   ends up needing it) broader S3/role-assumption access is exactly the kind of change the hard
   rules ask for a `security-reviewer` pass on before merge, and I don't have enough visibility into
   *why* the bootstrap roles refuse both root and this new role to propose a specific IAM statement
   with confidence. Guessing at a fix here risks widening `GitHubActionsCdkDiffRole` — deliberately
   built narrow and Deny-everything-else per ADR 20260808 — more than necessary.

It's plausible this has been broken since the bootstrap stack was created and nobody noticed,
because `cdk diff` always failed at the OIDC step before this session's fix, and a local root
session evidently also hits it (so it isn't new to CI).

## Proposed change

0. From a workstation with the `diveday-admin` profile, run `aws cloudformation describe-stacks
   --stack-name CDKToolkit` and inspect the bootstrap stack's `FilePublishingRoleDefaultPolicy` and
   the assets bucket's bucket policy (`aws s3api get-bucket-policy --bucket
   cdk-hnb659fds-assets-417160702652-us-east-1`). Confirm whether root is expected to work (it
   normally is, unless the bootstrap stack's `--trust`/`--trust-for-lookup` was scoped away from it)
   and whether the bucket policy requires SSL/a specific condition that CLI defaults don't satisfy.
1. If the bootstrap stack's trust policy is simply stale (e.g. `cdk bootstrap` run once, long
   before the `cdk-deployer` IAM user or `GitHubActionsCdkDiffRole`/`GitHubActionsCdkDeployRole`
   existed, with `--trust` naming only the account root and no `--trust-for-lookup`), consider
   re-running `cdk bootstrap` with the right `--trust`/`--trust-for-lookup`/`--cloudformation-execution-policies`
   flags — check `infra/lib/infra-stack.ts` §5's comment on `cdk-deployer` and `pnpm infra:deploy`'s
   bootstrap-related code first, since this stack likely already documents the intended trust set.
2. If instead the fix belongs on `GitHubActionsCdkDiffRole` itself (e.g. it genuinely needs
   `s3:GetObject*` on the assets bucket to build a real change set, without the broader
   `sts:AssumeRole` on bootstrap roles that `deploy` already has), scope that narrowly and get a
   `security-reviewer` pass — this role is reachable from any branch's `pull_request` run in a
   public repo, so anything added here is exposed broadly.
3. Either way, confirm the fix by re-running the `Infra` workflow's `diff` command and checking
   that `cdk diff`'s output no longer contains `fail: Bucket named ... but we dont have access to
   it`, and that a deliberate, throwaway infra change (e.g. adding then removing a harmless tag)
   shows up correctly in the diff.

## Prompt

```text
DiveDay's `Infra` GitHub Actions workflow can now assume its OIDC roles (fixed in PR #480,
2026-08-12), but `cdk diff` still can't build a real CloudFormation change set: neither
`GitHubActionsCdkDiffRole` nor an AWS-account-root local session can assume the CDK bootstrap
stack's `lookup-role`/`deploy-role`/`file-publishing-role`, or reach the
`cdk-hnb659fds-assets-417160702652-us-east-1` S3 bucket directly. `cdk diff` falls back to a
degraded template-only comparison and silently reports "no differences" even for changes that
plainly touch the template (confirmed against PR #480, which rewrites two IAM roles'
AssumeRolePolicyDocuments).

Read first: infra/lib/infra-stack.ts §5 (the cdk-deployer IAM user and its bootstrap-role
sts:AssumeRole grants) and §18 (GitHubActionsCdkDiffRole's policy, deliberately narrow —
ADR 20260808-github-actions-cdk-diff-deploy), plus docs/engineering/infrastructure-runbook.md.

From a workstation with the diveday-admin AWS profile: inspect the CDKToolkit bootstrap stack's
role trust policies (`aws cloudformation describe-stacks --stack-name CDKToolkit`) and the assets
bucket policy (`aws s3api get-bucket-policy --bucket cdk-hnb659fds-assets-417160702652-us-east-1`)
to find out why neither root nor GitHubActionsCdkDiffRole can reach them. Fix either the bootstrap
stack's trust configuration (likely: re-run `cdk bootstrap` with the right --trust flags) or add a
narrowly-scoped grant to GitHubActionsCdkDiffRole, whichever the investigation points to — the
latter needs a security-reviewer pass, since this role is reachable from any branch's pull_request
run in a public repo.

Done means: a real, throwaway infra change (e.g. add then remove a harmless CDK tag) produces an
actual diff in a `workflow_dispatch` run's `cdk diff` output, with no "Could not create a change
set" fallback message. Verify with `pnpm check` and by triggering the workflow. Delete
docs/product/follow-ups/FU-20260812-diff-role-cannot-reach-cdk-assets-bucket.md as part of the
change.
```
