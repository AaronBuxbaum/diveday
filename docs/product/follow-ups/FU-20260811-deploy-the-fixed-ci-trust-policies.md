# FU-20260811-deploy-the-fixed-ci-trust-policies — Deploy the stack once so CI can assume its own roles again

- **Status:** Open
- **Raised:** 2026-08-11 — PR #458, the first `infra/`-touching pull request since OIDC federation
  landed (ADR 20260808-github-actions-cdk-diff-deploy)
- **Kind:** half-done
- **Effort:** S
- **Touches:** `infra/lib/infra-stack.ts`, `.github/workflows/infra.yml`,
  `docs/architecture/decisions/20260808-github-actions-cdk-diff-deploy.md`

## What I noticed

The `cdk synth + diff` job fails on every pull request that touches `infra/`:

```
Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
role-to-assume: arn:aws:iam::417160702652:role/diveday-github-actions-cdk-diff
```

`cdk synth` itself passes — the job gets that far without credentials by design. It has been
invisible because the job is skipped on any PR that leaves `infra/` alone, which is nearly all of
them; PR #458 is the first run that reached the credentialed step at all.

The cause is fixed in code on that PR. `GITHUB_REPO` was spelled `aaronbuxbaum/diveday`, it lands in
an IAM `StringLike` on `token.actions.githubusercontent.com:sub`, GitHub mints that claim as
`repo:AaronBuxbaum/diveday:<context>` with the account name as its holder wrote it, and `StringLike`
is case-sensitive with no ignore-case variant. Both CI roles' trust conditions therefore matched
nothing, from any branch.

The stack itself is not stale — checked on 2026-08-11, `diveday-infra` was last updated at 17:57:55Z
that day — so the roles do exist and the spelling is the whole story. If that deploy came from a
`main` carrying the fix below, the trust policies are already correct and this entry may need
nothing but a re-run to confirm and close.

## Why it isn't already done

The fix is in the stack's source; AWS is still holding the trust policies built from the old
spelling. Only a `cdk deploy` replaces them, and CI cannot be the one to run it — the deploy job
would have to assume the very role whose trust policy is broken. It needs a workstation with the
admin credential, which no agent session has.

## Proposed change

0. Re-run the `Infra / cdk synth + diff` job first. The stack was deployed at 17:57:55Z on
   2026-08-11; if that deploy came from a `main` that already carried the casing fix, the trust
   policies are correct and the job will now get credentials — in which case confirm and delete this
   entry without deploying anything.
1. Otherwise run `pnpm infra:deploy` from a workstation carrying the `diveday-admin` profile (see
   [docs/engineering/infrastructure-runbook.md](../../engineering/infrastructure-runbook.md)).
2. Re-run the `Infra / cdk synth + diff` job on any open `infra/`-touching PR and confirm it now gets
   credentials and posts its diff comment. The same deploy should make the settings address
   type-ahead work again — check it, and close
   [FU-20260809](FU-20260809-confirm-address-lookup-region.md) if it does.
3. If it still cannot assume the role, the next thing to check is whether the deployed
   `GitHubActionsOidcProvider` exists at all and carries `sts.amazonaws.com` as a client id — the
   error is deliberately identical for a missing role, a missing provider and a non-matching
   condition, so it cannot be told apart from the outside.

Not proposing a workflow change: making the credentialed steps `continue-on-error` would hide the
next breakage of this chain exactly the way this one hid, and the job is only red on the PRs that
most need its diff.

## Prompt

```text
DiveDay's `Infra / cdk synth + diff` GitHub Actions job cannot assume its AWS role: "Not authorized
to perform sts:AssumeRoleWithWebIdentity" against
arn:aws:iam::417160702652:role/diveday-github-actions-cdk-diff. It fails on every pull request that
touches infra/, and is skipped (so invisible) on every other one.

Read first: section 18 of infra/lib/infra-stack.ts (the two OIDC roles and their trust conditions),
the GITHUB_REPO constant at the top of that file, .github/workflows/infra.yml's diff job, and
docs/architecture/decisions/20260808-github-actions-cdk-diff-deploy.md.

The code cause is already fixed: the trust conditions were spelled with a lower-cased account name
while GitHub mints the sub claim as repo:AaronBuxbaum/diveday:<context>, and IAM's StringLike is
case-sensitive. What remains is that AWS still holds the policies built from the old spelling, and
only a deploy replaces them — CI cannot do it, because the deploy job would have to assume the role
whose trust policy is the thing being repaired.

Do this: run `pnpm infra:deploy` from a workstation with the diveday-admin profile, then re-run the
Infra / cdk synth + diff job on an open infra/-touching PR. If it still fails, check that the
deployed GitHubActionsOidcProvider exists and carries sts.amazonaws.com as a client id — AWS returns
the identical error for a missing role, a missing provider and a non-matching condition.

Done means: the diff job assumes the role and posts its change-set comment on a pull request, stated
as an observation of a real run. Delete
docs/product/follow-ups/FU-20260811-deploy-the-fixed-ci-trust-policies.md as part of the change.
```
