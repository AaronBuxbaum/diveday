# 20260812-env-sync-is-workstation-only — The CI wizard skips the infra-deploy environment sync rather than being given Administration rights to run it

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amends:** [20260811-ci-deploy-full-wizard](20260811-ci-deploy-full-wizard.md) — its Decision says
  the CI deploy job runs "the whole wizard automatically, answering yes to every question", and its
  Consequences claim a CI deploy "finishes in the same state a workstation `pnpm infra:deploy` would
  leave it in", listing "the `infra-deploy` environment's reviewer list refreshed" among them. Those
  two claims are withdrawn for that one step. Everything else in that record -- the resource-scoped
  secret read, the `--ci-unattended` flag, the fail-loudly-never-skip rule for steps that *do* run --
  is unchanged.

## Context

The first CI deploy to get past `cdk deploy` and through the Vercel steps failed on the next one:

```
gh api --method PUT repos/AaronBuxbaum/diveday/environments/infra-deploy --input -
gh: Resource not accessible by personal access token (HTTP 403)
```

The environment `GET` in the same script succeeded, so the CI PAT can read environments but not write
their configuration. `PUT /repos/{owner}/{repo}/environments/{name}` needs repo
**Administration: write** -- not the "Environments" permission, which covers that environment's
*secrets and variables* rather than its protection rules. The `ci-github-admin-token` manual action's
permission list (Secrets, Variables, Environments) omits it, so the documented setup could never have
run this step.

Asked whether the workflow's built-in `GITHUB_TOKEN` could do it instead: no. The scopes settable
under a workflow's `permissions:` key are `actions`, `artifact-metadata`, `attestations`, `checks`,
`code-quality`, `contents`, `deployments`, `discussions`, `id-token`, `issues`, `packages`, `pages`,
`pull-requests`, `security-events`, `statuses`, `vulnerability-alerts` (verified against GitHub's
workflow-syntax reference, 2026-08-12). None of `administration`, `environments`, `secrets`, or
`variables` is among them -- which is the reason `ci-github-admin-token` exists at all, already stated
in its own `why`.

## Decision

**`runPostDeployWizard` skips the environment sync entirely when `ciUnattended` is set**, logging that
it did and why. It is not asked-and-declined; the question is not put at all, because a yes-answer
would be the wrong thing.

The case for skipping does not rest on the 403, which is only what surfaced it:

- **The step is a bootstrap.** It creates the `infra-deploy` environment and seeds a reviewer and a
  main-only branch policy. Once a human has configured that environment -- and one must have, since the
  deploy job cannot run at all until its approval gate exists -- re-running it in CI has nothing to add.
- **It rewrites the gate it is running inside.** By the time the wizard reaches this step, the job has
  already been authorized by the `infra-deploy` environment's required reviewer. A job editing the
  protection rules that admitted it is the wrong direction of control.
- **The reviewer it would add is the wrong identity.** `sync-github-cdk-ci-environment.mjs`'s own
  header comment already says so: in an unattended run the added reviewer is "whoever the
  INFRA_DEPLOY_GH_TOKEN PAT belongs to -- not necessarily the human who approved that specific deploy
  run". Adding a required reviewer nobody chose is worse than adding none.

So the CI PAT keeps Secrets and Variables and is **not** granted Administration.

## Alternatives considered

- **Add `Administration: read+write` to the CI PAT.** One setting, and the wizard would go fully
  green. Rejected: Administration covers collaborators, branch protection, and repository settings --
  far past the wizard's needs -- on a token reachable from a CI job, which is the shape ADRs 20260805,
  20260808 and 20260811 each deliberately narrowed. It would also let that job disable the very
  branch protection and reviewer requirements that gate it.
- **Use the workflow's `GITHUB_TOKEN`.** Not possible; see Context. No `permissions:` value grants the
  endpoint.
- **Ask the question in CI and let a "no" skip it.** Rejected as dishonest plumbing: `--ci-unattended`
  answers yes to everything by definition, so a question that must be answered no is not a question.
- **Keep calling it and tolerate the failure.** Rejected outright -- 20260811's fail-loudly rule is
  what makes the *other* wizard steps trustworthy, and carving a swallowed exception into it to
  accommodate one step that should not run is the "partial success papered over" shape it rejects.

## Consequences

A CI deploy no longer leaves the repository in *quite* the same state a workstation run would: the
`infra-deploy` environment's reviewer list is whatever a human last set, not refreshed to include the
PAT owner. That is the intended outcome, not a shortfall -- but it does mean 20260811's "same state as
a workstation" shorthand is no longer literally true, which is why this record amends it rather than
quietly diverging.

Setting up `infra-deploy` on a **new** environment or a fork remains a workstation `pnpm infra:deploy`
(or a hand-configured environment). Since the deploy job cannot run before that environment exists,
this cannot regress an existing setup -- there is no path where CI was the only thing creating it.

Escape hatch: if a future wizard step genuinely needs repo administration from CI, this decision is
the thing to revisit first, and the question to answer is why that job should be able to rewrite its
own approval gate -- not merely how to widen the token.
