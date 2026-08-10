# 20260808-github-actions-cdk-diff-deploy — Run `cdk diff`/`cdk deploy` from GitHub Actions via OIDC, with a two-tier role and a required-reviewer gate

- **Status:** Accepted
- **Date:** 2026-08-08
- **Relates to:** [20260805-cdk-minted-credentials-and-manual-actions](20260805-cdk-minted-credentials-and-manual-actions.md),
  [20260802-visual-diff-pr-comment](20260802-visual-diff-pr-comment.md)

## Context

Every CDK operation ran from a workstation. `pnpm infra:diff`/`pnpm infra:synth` (`scripts/infra-cdk.mjs`)
and `pnpm infra:deploy` (`scripts/infra-deploy.mjs`) all assume an interactive terminal that can open
`aws login`, and the identity behind them — `cdk-deployer` — is explicitly workstation-only: its own
comment in `infra-stack.ts` §5 says to "treat this key as an administrator credential", and
20260805 marks it never-copy-to-GitHub for that reason. A PR that changed `infra/lib/infra-stack.ts`
therefore showed nothing about its effect until someone ran `cdk diff` by hand, and deploying meant
finding a workstation with `diveday-deployer`/`diveday-admin` configured.

`corymhall/cdk-diff-action` — maintained by an AWS CDK core team member, and the action AWS's own CDK
documentation points to for this — posts the CloudFormation diff for every stack in a CDK app as a PR
comment, updated in place on each push, with `failOnDestructiveChanges` on by default. It needs a
pre-synthesized `cdk.out` and AWS credentials already configured in the job; it does not synthesize
or authenticate on its own.

`cdk synth` needs no AWS credentials for this app: `infra/lib/infra-stack.ts` performs no context
lookups (no `Vpc.fromLookup`, no `StringParameter.valueFromLookup`), confirmed by running it with no
credentials configured. `cdk diff` and `cdk deploy` do, to read and change the deployed stack.

## Decision

Add `.github/workflows/infra.yml` and, in `infra-stack.ts` §18, an `iam.OpenIdConnectProvider` for
`token.actions.githubusercontent.com` plus **two** IAM roles GitHub Actions assumes via OIDC — no
long-lived AWS keys in GitHub, matching the direction 20260805 already pushed every other identity
toward.

- **`GitHubActionsCdkDiffRole`** — trust condition `repo:aaronbuxbaum/diveday:*` (any workflow run in
  this repo). Permissions: `cloudformation:{DescribeStacks,GetTemplate,CreateChangeSet,
  DescribeChangeSet,DeleteChangeSet}` and `ssm:GetParameter` on the bootstrap-version parameter,
  scoped to the `diveday-infra` stack. It can create and inspect a change set to compute an accurate
  diff; it cannot execute one, and it does not hold `sts:AssumeRole` on any CDK bootstrap role — so it
  cannot reach the bootstrap `deploy-role`'s CloudFormation execution permissions (AdministratorAccess
  by default) at all. `.github/workflows/infra.yml`'s `diff` job runs on every `pull_request` that
  touches `infra/`, and posts the comment via `corymhall/cdk-diff-action`.
- **`GitHubActionsCdkDeployRole`** — trust condition `repo:aaronbuxbaum/diveday:environment:infra-deploy`.
  GitHub only issues an OIDC token for a job that references a GitHub Environment once that
  environment's required reviewer has approved the run — so the trust condition alone makes the role
  unassumable until a human clicks "Approve and deploy" in the Actions UI, independent of anything the
  workflow file does. Permissions mirror `cdk-deployer` (§5): `sts:AssumeRole` on the four
  `cdk-<qualifier>-*-role` bootstrap roles, which is what the modern (`newStyleStackSynthesis`)
  synthesizer actually needs — the bootstrap roles carry the real deploy-time permissions, not the
  caller. `.github/workflows/infra.yml`'s `deploy` job runs only on `workflow_dispatch` with
  `command: deploy`, and declares `environment: infra-deploy`.

Both roles carry an explicit `Deny` on `secretsmanager:GetSecretValue` (resource `*`), the same
pattern §6's read-only MCP identities use: `cdk deploy`'s resource writes run under the bootstrap
`deploy-role`'s own permissions, not the calling identity's, so the Deny costs nothing the deploy
needs and bounds what a compromised workflow run — a much larger attack surface than a workstation —
could do with the caller's own credentials. Neither role can read `diveday/env`, which is why the
`deploy` job runs `cdk deploy` directly rather than `pnpm infra:deploy`: that wrapper's post-deploy
step reads that secret with an administrator profile to write `.env.local`/`.env.vercel`/`.env.github`,
and is left workstation-only on purpose (§17, `credentials-off-dotenv`).

Creating the `infra-deploy` GitHub Environment with a required reviewer, and setting the two role ARNs
(CDK outputs `GitHubActionsCdkDiffRoleArn`/`GitHubActionsCdkDeployRoleArn`) as the
`AWS_CDK_DIFF_ROLE_ARN`/`AWS_CDK_DEPLOY_ROLE_ARN` repository variables, are both offered as yes/no
prompts in `pnpm infra:deploy`'s post-deploy wizard (`scripts/post-deploy-wizard.mjs`), the same
pattern the wizard already uses for the reg-suit GitHub secrets — `scripts/sync-github-cdk-ci-vars.mjs`
runs `gh variable set` after reading the two `CfnOutput`s, and
`scripts/sync-github-cdk-ci-environment.mjs` `PUT`s the environment with the `gh` CLI's authenticated
user as its reviewer. Manual action `github-actions-cdk-oidc` (§17) documents the underlying commands
for a workstation without the wizard, but neither step is CloudFormation's to do — nothing in this
stack has a credential for GitHub's own API, the same reason `credentials-to-vercel` is a hand-off
rather than a `CfnOutput`.

## Alternatives considered

- **One role for both diff and deploy.** Rejected: a PR from any branch can trigger the `diff` job, so
  that role's trust condition has to stay broad. Folding deploy permissions into it would mean every
  PR in the repo could assume a role that can reach `AdministratorAccess` via the bootstrap
  `deploy-role`, with only the workflow file's own logic — not IAM — stopping it from executing a
  change set. The two-role split makes the boundary a trust-policy fact, not a workflow convention.
- **Static IAM access keys as GitHub secrets**, matching the existing `REG_SUIT_AWS_ACCESS_KEY_ID`
  pattern. Simpler to wire up, no `infra-stack.ts` change needed — but a long-lived credential capable
  of `cdk deploy` sitting in GitHub is a materially worse blast radius than a short-lived OIDC token
  scoped to one environment, and 20260805 already moved this stack away from handing out long-lived
  keys wherever an alternative existed.
- **`workflow_dispatch` alone as the deploy gate, no GitHub Environment.** Rejected: `workflow_dispatch`
  proves a human clicked "Run workflow", but a compromised or malicious workflow *file* on a
  feature branch could still declare `command: deploy` and fire it via the API — nothing about the
  trigger itself is repo-content-independent. The environment's required-reviewer approval is a second,
  independent gate that happens after the run starts and cannot be satisfied by editing YAML.
- **Route the role ARNs through the `diveday/env` Secrets Manager document** (§16), like the reg-suit
  credentials. Rejected: that pipeline (`credentials-document.ts` → `.env.example` → `distribute-env.mjs`
  → the post-deploy wizard) exists for values a local developer also needs and for secrets that rotate
  on `CredentialSerial`. A role ARN is neither — no developer runs `cdk diff` by assuming this role
  locally, and the ARN does not rotate — so it stays a `CfnOutput` and a one-time manual action instead
  of new cases in that machinery.
- **A third role, or a `lookup-role` grant on the diff role**, for future context lookups. Deferred:
  this stack does none today (confirmed by running `cdk synth` with no AWS credentials), so granting it
  now would be unused privilege. Revisit if a future change adds a `fromLookup` call — `cdk diff` would
  start failing on `AccessDenied` for that specific role, which is a legible failure to work from.
- **Leave the GitHub Environment and role-ARN variables as hand-typed `manual-actions.md` instructions**,
  with no wizard automation. Rejected once it was clear both steps are exactly as `gh`-CLI-automatable
  as the existing reg-suit secrets sync the wizard already runs (`scripts/sync-github-secrets.mjs`) —
  leaving them manual would have been an inconsistency with that precedent, not a safer default. The
  environment-reviewer step still requires an explicit `[y/N]` answer each time, matching how the
  wizard already gates comparably consequential steps ("Deploy the linked Vercel project to
  Production?").

## Consequences

- A PR that touches `infra/` gets a `cdk synth` check for free (no credentials needed to fail loudly on
  a broken template) and a `cdk diff` PR comment once the wizard's two GitHub prompts have been answered
  yes at least once. Until then, the `diff` job's `configure-aws-credentials` step fails clearly
  (`role-to-assume` resolves to an empty string, and a pre-flight step in `infra.yml` names the missing
  variable and points at manual action `github-actions-cdk-oidc`) rather than silently skipping.
- `cdk deploy` from CI is possible for the first time, but only behind two independent locks: an
  explicit `workflow_dispatch` with `command: deploy`, and a required-reviewer approval on the
  `infra-deploy` environment. `pnpm infra:deploy` from a workstation is unchanged and remains the only
  path that also syncs `.env.local`/`.env.vercel`/`.env.github`.
- `manual-actions.test.ts`'s secret-value-denial assertion now expects four `Deny` statements, not two
  — a future identity added to this stack without one will fail that test rather than pass by omission.
- Untested end to end: this sandbox has no AWS account to deploy against, so the OIDC trust conditions,
  the bootstrap-role `AssumeRole` chain, and the environment-approval gate are verified by reading the
  synthesized template (`cdk synth`, inspected directly) and by this stack's existing unit tests, not by
  a live `cdk diff`/`cdk deploy` run. `sync-github-cdk-ci-vars.mjs` and `sync-github-cdk-ci-environment.mjs`
  are unit-tested against a stubbed `gh` binary, but the first real exercise of the whole chain — the
  wizard prompts, the `gh api` calls they make, and the workflow assuming the resulting roles — is the
  PR that lands this, after `pnpm infra:deploy` is run once.
- Escape hatch: if GitHub Environment approval proves too slow or friction-heavy for a solo operator,
  the fix is loosening `infra-deploy`'s reviewer requirement, not removing the environment — the OIDC
  trust condition would need updating in the same change, since it names the environment by string.

## Security review findings

An adversarial review of this change (before merge) found two real bugs and confirmed two more as
accepted, documented tradeoffs rather than oversights:

- **Fixed — `sync-github-cdk-ci-environment.mjs` was destructively overwriting the reviewer list.**
  Its own header comment claimed re-running it "does not remove anyone else's approval right", but the
  code unconditionally `PUT`-replaced `reviewers` with a single-element array, and the original test
  asserted exactly that destructive body. A human who later added a second reviewer by hand — the
  documented way to strengthen the gate — would have had it silently wiped by the next routine
  `pnpm infra:deploy`. Fixed by `GET`-ing the environment first and only ever *adding* the current user
  to whatever reviewer list already exists (deduped, never removing an entry this script didn't add);
  `wait_timer`/`prevent_self_review` are carried forward unchanged from an existing environment.
- **Fixed — `deployment_branch_policy: null` let `cdk deploy` run from any branch.** The trust
  condition only checks that a job declared `environment: infra-deploy`, not which ref it ran from, and
  `workflow_dispatch` lets the invoker pick any branch — so unrestricted branch policy meant the
  "reviewed code merged to main" assumption the rest of this document leans on was not actually
  enforced by anything. Fixed by restricting first-time environment creation to a `main`-only custom
  branch policy (`custom_branch_policies: true` plus a registered `main` policy, not
  `protected_branches: true` — that depends on branch protection being separately configured on `main`,
  and silently allows *zero* branches to deploy if it isn't). An environment that already exists keeps
  whatever branch policy is currently set, so a human's later change here survives a re-run.
- **Accepted — the environment's sole required reviewer can self-approve their own deploy.**
  `prevent_self_review` stays `false`, and the reviewer is always the `gh` CLI's current user — so the
  person who clicks "Run workflow" can also click "Approve and deploy". This is a real gap relative to
  "a second person reviewed it," but the gate's actual value for a solo operator is what the
  Alternatives section above already argues: it turns "workflow_dispatch was clicked" into "a human
  consciously clicked twice, in the Actions UI, after seeing the pending-deployment prompt" — not
  editable by rewriting the workflow YAML. Revisit this the moment a second person, or a less-trusted CI
  identity, gets write access to this repo: at that point a real second reviewer becomes both possible
  and necessary, and the fix the destructive-overwrite bug above closes is what makes adding one durable.
- **Accepted, with defense in depth added — fork pull requests and `GitHubActionsCdkDiffRole`.** The
  role's trust condition (`repo:aaronbuxbaum/diveday:*`) accepts any `pull_request`-triggered run in
  this repo, and GitHub's exact behavior for OIDC token issuance on a fork-originated `pull_request` run
  was not something this review could verify live. The repository's actual, current control is
  `pull_request_creation_policy: collaborators_only` (a GitHub repo setting, confirmed via the API) —
  non-collaborators cannot open a PR against this repo at all, fork or not, so the theoretical gap has
  no one able to trigger it today. `.github/workflows/infra.yml`'s `diff` job now also skips every
  AWS-credentialed step (everything after `cdk synth`, which needs no credentials regardless) when
  `github.event.pull_request.head.repo.full_name != github.repository`, as defense in depth that holds
  even if the collaborator restriction is ever loosened.
