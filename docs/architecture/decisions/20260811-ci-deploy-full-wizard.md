# 20260811-ci-deploy-full-wizard — Run the full post-deploy wizard, non-interactively, from CI's deploy job

- **Status:** Accepted
- **Date:** 2026-08-11
- **Amends:** [20260808-github-actions-cdk-diff-deploy](20260808-github-actions-cdk-diff-deploy.md)'s
  Decision and Consequences claims that "neither role can read the credentials secret" and that
  "`pnpm infra:deploy` from a workstation ... remains the only path that also syncs
  `.env.local`/`.env.vercel`/`.env.github`." Both are withdrawn for `GitHubActionsCdkDeployRole`
  specifically. Everything else in that record — the two-role split, `GitHubActionsCdkDiffRole`'s
  unscoped Deny, the required-reviewer environment gate, the OIDC trust conditions — is unchanged.

## Context

20260808 wired CI to run `cdk deploy` directly rather than `pnpm infra:deploy`, because
`GitHubActionsCdkDeployRole` carried an unscoped Deny on `secretsmanager:GetSecretValue` and so
could not read the `diveday/env` credentials document the wrapper's post-deploy step needs. That
left CI able to change infrastructure but not to finish the deploy the way a workstation operator
does: writing `.env.local`/`.env.vercel`/`.env.github` and running the six-question post-deploy
wizard (sync AWS CLI profiles, push Vercel env, deploy Vercel, sync GitHub secrets, set the CDK
role ARNs as repository variables, create/update the `infra-deploy` GitHub Environment, add SES DNS
records). Every deploy since has needed a human at a workstation for that second half, even though
the required-reviewer approval on `infra-deploy` (the same gate that unlocks the deploy role's OIDC
token at all) already establishes "a human consciously approved this run" before the job's first
AWS call.

The ask this record answers: once that approval has happened, run the whole wizard automatically,
answering yes to every question, so a deploy from CI finishes in the same state a workstation
`pnpm infra:deploy` would leave it in.

## Decision

**`GitHubActionsCdkDeployRole` gets a resource-scoped read on exactly one secret.**
`infra-stack.ts` §18 replaces that role's `denyReadingAnySecret()` call with two statements: an
`Allow` on `secretsmanager:GetSecretValue` scoped to `credentialsSecret.secretArn` (the
`CredentialsEnvDocument`/`diveday/env` secret and nothing else), and a `Deny` on the same action
scoped by `NotResource` to that same ARN — every *other* secret in the account, including the
`ApplicationSecretSeed` this stack also creates, is still unreachable. `GitHubActionsCdkDiffRole`
is untouched: it keeps the original unscoped Deny, because it is assumable by any branch's
`pull_request` run and never should read anything.

The role also gets `ssm:GetParameter`/`ssm:PutParameter` scoped to
`/diveday/env-sync/vercel/*` — the fingerprint checkpoint
[20260811-vercel-sync-checkpoint-in-ssm](20260811-vercel-sync-checkpoint-in-ssm.md) added, which
`import-vercel-env.mjs`'s wizard step reads and writes.

**`.github/workflows/infra.yml`'s `deploy` job runs `pnpm infra:deploy DiveDay --require-approval
never`** instead of a bare `cdk deploy`, with `GH_TOKEN`/`VERCEL_TOKEN`/`VERCEL_ORG_ID`/
`VERCEL_PROJECT_ID` supplied as job env from new repository secrets/variables (manual actions
`ci-github-admin-token` and `ci-vercel-deploy-token`, §17) — the wizard shells out to the `gh` and
`vercel` CLIs the same way a workstation run does, and neither is authenticated by the OIDC role
that only AWS trusts.

**`scripts/infra-deploy.mjs` picks a third mode.** The post-deploy branch was interactive-terminal
or nothing; it is now `--no-wizard` → skip, TTY and not CI → interactive (unchanged), `CI` set →
run `runPostDeployWizard` with `ask: async () => "yes"`, else → print the "run this in a terminal"
message (unchanged). CI's own approval gate is what "unblocked manually" already means by the time
this process runs — nothing inside the script blocks a second time. A step whose own command fails
(an expired PAT, a revoked Vercel token) throws and exits the process non-zero, same as any other
failed deploy step; there is no partial-success state to paper over.

The secret-read environment-selection logic (previously "always swap `AWS_PROFILE` to
`diveday-admin` and strip ambient keys") is now conditioned on `process.env.CI`: on a workstation it
is unchanged, and in CI the ambient OIDC-assumed credentials from the deploy step just above are
reused as-is — there is no `diveday-admin` profile on a runner to swap to, and the role granted
above can now read the one secret directly. `import-vercel-env.mjs`'s own admin-profile swap for the
Vercel-sync checkpoint gets the identical CI-aware branch, for the identical reason.

## Alternatives considered

- **Give the deploy role a temporary AssumeRole into a CI-only "diveday-ci-admin" identity** instead
  of widening its own policy. Rejected: it reintroduces exactly the shape 20260805 and 20260808 both
  moved away from — an administrator-equivalent identity reachable from CI — for a capability that
  needs precisely one secret. The resource-scoped Allow is narrower and auditable from the role's own
  policy document, with nothing to assume.
- **Keep CI at `cdk deploy` only and have a human run `pnpm infra:deploy` from a workstation
  afterward**, i.e. leave 20260808 exactly as it stood. This is the status quo this record replaces;
  rejected because it is the thing being asked for — a deploy approved once should not still need a
  human at a second keyboard to finish.
- **A separate, third GitHub Actions job that only runs the wizard**, gated behind the same
  environment, so `GitHubActionsCdkDeployRole`'s policy would stay untouched and a new role would
  carry the secret read instead. Rejected as complexity with no safety gain: a second role trusted by
  the same environment is reachable by the same approval, so splitting it does not shrink what one
  approved run can do — it only adds a role to keep in sync with the first.
- **Route the CI-only GitHub PAT and Vercel token through the `diveday/env` Secrets Manager
  document**, like the reg-suit credentials. Rejected for the same reason 20260808 rejected routing
  the role ARNs there: that pipeline is for values a local developer also needs or that rotate on
  `CredentialSerial`. Neither token is either — no developer runs the CI wizard locally, and CDK has
  no way to mint a GitHub or Vercel credential to put there in the first place.
- **Scope the deploy role's Deny with a `Condition` instead of `NotResource`.** Equivalent in effect;
  `NotResource` was chosen because it reads directly as "every secret but this one" without a second
  policy-language construct to explain, matching how `denyReadingAnySecret()` already reads for the
  other three identities.

## Consequences

A `workflow_dispatch` deploy, once its required reviewer approves, now finishes in the same state a
workstation `pnpm infra:deploy` would leave it in — `.env.local`/`.env.vercel`/`.env.github`
written, Vercel Production environment variables pushed, the Vercel project deployed, GitHub Actions
secrets synced, the CDK role-ARN repository variables set, the `infra-deploy` environment's reviewer
list refreshed, and SES DNS records added — with no second human needed at a workstation.

`GitHubActionsCdkDeployRole` is no longer bound by an absolute "cannot read any secret" claim; it is
bound by "can read exactly one, and only after a human has already approved this specific run." That
approval is still the entire control — nothing about the resource-scoped Allow can be exercised by an
identity that could not already reach the secret's contents by other means (§16's own comment on the
deployer identity already establishes that holding `cdk deploy` on this stack is equivalent to
reading it once).

Two new manual, no-CLI-can-do-this actions exist (`ci-github-admin-token`, `ci-vercel-deploy-token`,
§17): minting a fine-grained GitHub PAT and a Vercel token, each stored as a GitHub Actions secret.
Both are broader-reaching credentials than the AWS_CDK_*_ROLE_ARN repository variables 20260808
added, and both are reachable only from the job the environment approval already gates — the same
tradeoff 20260808's "Accepted" security-review finding already named for the reviewer being able to
self-approve their own deploy.

Untested end to end, the same way 20260808 was at merge: this sandbox has no live AWS account, no
GitHub PAT, and no Vercel token to exercise the real `gh`/`vercel` CLI calls against. The IAM shape
is verified by `cdk synth` and `infra/lib/manual-actions.test.ts`'s resource-scoped Allow/Deny
assertions; the script branching is verified by `scripts/infra-deploy.test.mjs` and
`scripts/import-vercel-env.test.mjs` against stubbed `aws`/`gh`/`pnpm`/`cdk` binaries; the wizard's
own step content is unchanged and already covered by `scripts/post-deploy-wizard.test.mjs`. The
first real CI-run wizard — whether the Vercel CLI's `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` env vars
are actually sufficient to skip `vercel link`'s interactive prompt on a fresh checkout with no
`.vercel/project.json` — is the same kind of gap 20260808's casing bug came from, and is worth
watching the first time `command: deploy` runs after both manual actions are done.

Escape hatch: if this proves too broad in practice (a compromised workflow file on a branch that
somehow reaches `environment: infra-deploy`, or the reviewer-can-self-approve gap 20260808 already
accepted turning out to matter), the fix is reverting `cdkDeployRole`'s policy to
`denyReadingAnySecret()` and the `deploy` job's `run:` line to a bare `cdk deploy` — both one-line
changes, since nothing else in this record couples to the wider read.
