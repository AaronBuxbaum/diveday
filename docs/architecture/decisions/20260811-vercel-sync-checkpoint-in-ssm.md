# 20260811-vercel-sync-checkpoint-in-ssm — Diff Vercel env pushes against an SSM fingerprint, not a workstation file

- **Status:** Accepted
- **Date:** 2026-08-11
- **Supersedes:** nothing. Follows the same day's fix to `import-vercel-env.mjs`'s diff (#466),
  which itself replaced a `vercel env pull`-based diff that could never see a sensitive value.

## Context

`import-vercel-env.mjs` pushes every DiveDay environment variable to Vercel with `--sensitive`, and
Vercel never returns a sensitive value again once one is set — not to the dashboard, not to `vercel
env pull`, not to the API. The script's first fix for this (#466) diffed candidate values against a
local checkpoint file, `.env.vercel.synced.<environment>`, gitignored next to `.env.vercel` — the
same technique `sync-github-secrets.mjs` already used for GitHub's equally write-only Actions secrets
API.

A file on one workstation is a narrower fix than it looks. `import-vercel-env.mjs` only ever runs
interactively through the post-deploy wizard (`infra-deploy.mjs` explicitly skips it in CI), so the
checkpoint lives wherever whoever ran `pnpm infra:deploy` happened to be sitting. A second operator,
a reformatted laptop, or a fresh worktree has no way to see that Vercel is already in sync and pushes
every value once for no reason — not wrong, but exactly the churn the checkpoint exists to avoid.
That same post-deploy step already authenticates one shared identity for this purpose: the
`diveday-admin` AWS profile, the only one that can read the `diveday/env` Secrets Manager document
the deployer key it just ran `cdk deploy` with cannot.

## Decision

**Move the Vercel sync checkpoint into one SSM Parameter Store `String` parameter per environment,
`/diveday/env-sync/vercel/<environment>`, read and written under the same `diveday-admin` channel
`infra-deploy.mjs` already opens to read `diveday/env`.**

- The parameter holds fingerprints, not values: one `KEY=<sha256-hex>` line per pushed variable, in
  the same dotenv-line shape used everywhere else in this tooling. Nothing in this parameter can
  reconstruct a secret; it exists only to answer "did this change since the last push."
- `import-vercel-env.mjs` authenticates the same way `infra-deploy.mjs`'s post-deploy handoff does —
  `INFRA_ENV_SYNC_PROFILE` (default `diveday-admin`), ambient `AWS_ACCESS_KEY_ID`/etc. stripped
  because AWS gives them precedence over `AWS_PROFILE`, then `ensureAwsLogin` opens the browser login
  flow if that session has expired.
- A missing parameter (`ParameterNotFound`) is the ordinary first-sync case and pushes everything,
  silently. Any other read failure (permissions, network, a renamed parameter) warns and also falls
  back to pushing everything, matching the fallback discipline the original `vercel env pull`-based
  diff already used — an optimization is never allowed to block the sync itself.
- No CDK change. `diveday-admin` is a human operator's own administrator-equivalent login, not an
  IAM identity this stack issues or scopes — it is already the profile with authority to read
  `diveday/env`, which nothing less than administrator-equivalent access can do. A parameter this
  profile writes needs no new policy, and `put-parameter` creates it on first use.

## Alternatives considered

- **Keep the local file (#466's fix, shipped hours earlier the same day).** Simplest, and already
  fixes the actual reported bug — Vercel replacing every variable on every deploy. Superseded here
  because it doesn't survive a second operator or a new machine, which this account-wide parameter
  does for the same authentication cost the step already pays.
- **Store the last-pushed values themselves, not fingerprints, in Secrets Manager.** Would make
  Secrets Manager (or SSM `SecureString`) a second copy of every production secret, redundant with
  both Vercel and 1Password, and would need `kms:Decrypt` wired into the admin profile's trust for no
  benefit over a hash — the diff only ever needs to know "same or different," never the value.
- **A CDK-managed parameter with a scoped IAM policy for a limited role.** Rejected for now: the only
  caller is already the administrator-authenticated post-deploy step, so a scoped policy would add a
  stack redeploy dependency to change build tooling without buying any additional safety over the
  blanket access that step already has.

## Consequences

- The checkpoint now travels with the AWS account, not a workstation: any operator who can
  authenticate `diveday-admin` sees the real "already in sync" state, so switching laptops or
  starting from a clean worktree no longer forces one wasted full push.
- One new AWS resource type enters the deploy tooling's dependency surface (SSM Parameter Store),
  read/written only by `import-vercel-env.mjs`, never by the application at runtime.
- `sync-github-secrets.mjs`'s equivalent checkpoint, `.env.github.synced`, is untouched and keeps its
  local-file semantics — that sync step has no admin-authenticated AWS channel already open the way
  this one does, so moving it would need its own justification rather than following this one by
  default.
- Standard-tier `String` parameters cap at 4KB; the current Vercel-bound key set (41 keys) fingerprints
  to roughly 3.5KB. If the registry grows enough to exceed it, `put-parameter` fails loudly (nonzero
  exit, not silent corruption) and the fix is adding `--tier Advanced` to the `put-parameter` call.
