# 20260812-github-oidc-sub-embeds-immutable-ids — Build GitHub Actions OIDC trust conditions from `owner@ownerId/repo@repoId`, not bare `owner/repo`

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amends:** [20260808-github-actions-cdk-diff-deploy](20260808-github-actions-cdk-diff-deploy.md) —
  its Decision and the "What actually broke" retro both state the trust conditions as
  `repo:AaronBuxbaum/diveday:*` / `repo:AaronBuxbaum/diveday:environment:infra-deploy`. That specific
  string is withdrawn; everything else in that record (the two-role split, the unscoped Deny, the
  required-reviewer environment gate) is unchanged. Also closes follow-up
  `FU-20260811-deploy-the-fixed-ci-trust-policies` (deleted in this change, per its own template),
  whose own diagnosis — a stale deploy of the casing fix — turned out to be wrong: the casing fix was
  already deployed; the actual cause was this.

## Context

Every credentialed step in `.github/workflows/infra.yml` — `diff` and `deploy` alike — failed with
`Not authorized to perform sts:AssumeRoleWithWebIdentity`, on every branch and every trigger, even
after confirming (via `aws iam get-role`, `aws iam list-open-id-connect-providers`,
`aws sts get-caller-identity`, and `aws organizations describe-organization`) that the deployed trust
policy, the OIDC provider, the AWS account, and the absence of an Organization/SCP were all
individually correct — the exact shape 20260808's casing bug produced, but with every cause that bug
had ruled out.

The cause was only visible by decoding a *real* token: a temporary workflow step
(`ACTIONS_ID_TOKEN_REQUEST_URL` + `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, decoded client-side, printed as
claims only — never the raw token, since this repo's Actions logs are public) showed

```
sub: repo:AaronBuxbaum@5578581/diveday@1302222351:ref:refs/heads/main
```

GitHub now mints the `repo:` segment of the `sub` claim as `owner@ownerId/repo@repoId`, not the bare
`owner/repo` every piece of GitHub's own documentation and this repo's prior ADR assumed. A
`StringLike` built from `repo:AaronBuxbaum/diveday:*` is not a prefix of that string — `@5578581` and
`@1302222351` land before the `/` and the first `:` respectively — so it matches nothing, for the same
reason the lower-cased string in 20260808 matched nothing: `StringLike` requires the literal prefix up
to the wildcard, and neither casing nor an omitted ID survives that check.

## Decision

`infra-stack.ts` §pre-18 adds `GITHUB_REPO_SUB = "AaronBuxbaum@5578581/diveday@1302222351"`, built from
GitHub's own immutable identifiers — this repository's account id and repository id, stable across a
rename or an ownership transfer (presumably why GitHub started embedding them: a deleted-and-recreated
repo of the same name now mints a different `sub` and stops matching a trust policy built by name
alone, closing a spoofing gap). Both `GitHubActionsCdkDiffRole` and `GitHubActionsCdkDeployRole`'s
trust conditions are built from `GITHUB_REPO_SUB` instead of `GITHUB_REPO`. `GITHUB_REPO` itself is
kept — it has no other reader in `infra-stack.ts`, but the bare `owner/repo` string is still the
readable one for a comment or a future non-`sub` use, and rebuilding it from `GITHUB_REPO_SUB` by
stripping `@id` suffixes would be more code than the duplication it avoids.

## Alternatives considered

- **Check whether GitHub's repository-level OIDC subject-claim customization could turn this back
  off**, reverting to a name-only `sub` and avoiding a stack redeploy entirely. Not pursued: no tool
  available in this session exposes that setting, and it did not appear to be something this specific
  repository had opted into (a personal-account repo, not an organization) — reading as GitHub's
  current default rather than a toggle a past session flipped. A trust policy that depends on a
  platform default staying put is worse than one that matches the claim GitHub actually sends.
- **Widen the `StringLike` to tolerate either shape** (e.g. matching on a suffix instead of a prefix,
  or dropping to `sub` containing `diveday` anywhere). Rejected: weakens the trust condition for no
  reason once the actual shape is known, and a suffix-only match on `:ref:refs/heads/main` or
  `:environment:infra-deploy` would accept the same suffix from a *different* repository entirely —
  exactly the ambiguity the owner/repo prefix exists to rule out.

## Consequences

The trust conditions now match what GitHub actually issues, confirmed against a real decoded token
rather than documentation. This makes them **more** guessable-if-wrong the same way the casing bug
was: a hand-edited `GITHUB_REPO_SUB` that drifts from the account/repo's real numeric ids reproduces
this exact failure mode a third time, with no test able to catch it locally (`cdk synth` has no way to
ask GitHub what `sub` it will mint). The comment on `GITHUB_REPO_SUB` in `infra-stack.ts` says how it
was obtained, for whoever next has to re-derive it.

Escape hatch: if this repository is ever transferred to a different owner or renamed, both ids change
(the repository id survives a rename but not a transfer to a different owner account; the owner id is
stable across a repo rename but not an owner rename/transfer) and every credentialed `infra/` CI step
fails identically to this incident until `GITHUB_REPO_SUB` is updated and the stack redeployed —
worth a line in the transfer runbook if one exists by then; none does today.
