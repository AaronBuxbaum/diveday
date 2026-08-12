# FU-20260812-ci-wizard-runs-steps-with-no-credential — Fail loudly when a wizard credential resolves empty, instead of passing "" to the gh/vercel CLI

- **Status:** Open
- **Raised:** 2026-08-12 — the first `command: deploy` CI run that actually reached the deploy job
  (run 31564090783), after the transitive-skip fix in PR #483
- **Kind:** improvement
- **Effort:** S
- **Touches:** `scripts/post-deploy-wizard.mjs`, `.github/workflows/infra.yml`

## What I noticed

The first real CI deploy got all the way through `cdk deploy` (the stack updated: `✅ DiveDay
(diveday-infra)`, 27.93s) and then failed in the post-deploy wizard. The job's own env dump shows why
it was always going to:

```
GH_TOKEN:
VERCEL_TOKEN:
VERCEL_ORG_ID:
VERCEL_PROJECT_ID:
```

All four are empty, and the run gives no way to tell *why*. Two quite different causes produce this
identical output, and during the incident both looked plausible:

- the credential genuinely had not been created yet (the `ci-github-admin-token` /
  `ci-vercel-deploy-token` manual actions, §17 of `infra/lib/infra-stack.ts`, not done); or
- the credential existed but under a name the workflow was not reading. At the time of this run the
  workflow read `secrets.INFRA_DEPLOY_GH_TOKEN`, `secrets.INFRA_DEPLOY_VERCEL_TOKEN`, and
  `vars.VERCEL_ORG_ID` / `vars.VERCEL_PROJECT_ID`, while the values were later found stored as
  `infra-deploy` *environment secrets* named `GH_TOKEN` / `VERCEL_TOKEN` / `VERCEL_ORG_ID` /
  `VERCEL_PROJECT_ID` — different names, and for the two ids a different *kind* of thing (secrets,
  not variables). The names have since been aligned on both sides.

Which of the two it was on this particular run was never established, and that is exactly the
complaint. GitHub resolves an absent secret or variable to the empty string with no warning of any
kind, so a typo'd name, a secret stored at the wrong scope, and a setup step nobody has done are all
indistinguishable from inside the run — and each one surfaces minutes later, inside `gh` or `vercel`,
phrased as an authentication problem that names neither the variable nor the setup step.

`.github/workflows/infra.yml` already has exactly the right pattern one job earlier, in its "Confirm
the deploy role ARN is set" step, which catches an empty `vars.AWS_CDK_DIFF_ROLE_ARN` and names the
manual action to fix it. The wizard's own four credentials have no equivalent.

Worth being precise about what is *not* broken: the wizard failing hard rather than skipping is
deliberate (ADR 20260811-ci-deploy-full-wizard: "A step whose own command fails ... throws and exits
the process non-zero ... there is no partial-success state to paper over"). This is only about the
error a human reads when it does.

## Why it isn't already done

Out of the scope I was given — the session was chasing an OIDC assume-role failure and then a
silently-skipping deploy job, and this is a third, unrelated thing the first successful deploy
happened to reveal. It also overlaps a judgement call worth making deliberately rather than in
passing: whether a CI deploy with no Vercel/GitHub credentials should fail at that step (loudly, as
today) or refuse to start at all, which is a different answer to "what does a half-finished deploy
mean" than ADR 20260811 settled for the mid-wizard case.

## Proposed change

Either, but decide which:

1. **Pre-flight, matching the existing role-ARN pattern.** Add a step to the `deploy` job in
   `.github/workflows/infra.yml`, before `pnpm infra:deploy`, that fails with an
   `::error::`-annotated message naming both the empty variable and the manual action that supplies
   it (`ci-github-admin-token`/`ci-vercel-deploy-token`) when any of the four `infra-deploy`
   environment secrets (`GH_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) is empty.
   Naming the *variable* is what makes this catch a name mismatch and not just a missing setup step.
   Refuses before touching AWS at all, so a deploy is never half-done for this reason.
2. **Check inside the wizard**, in `scripts/post-deploy-wizard.mjs`, immediately before each step that
   shells out to `gh`/`vercel`: if the credential that step needs is absent, throw with the manual
   action's name rather than letting the CLI fail. Keeps the check next to the thing that needs it,
   but the stack has already deployed by then — the same partial state as today, just better labelled.

Not proposing: skipping a credential-less step and continuing. That is the "partial success papered
over" shape 20260811 explicitly rejected, and it would let a deploy report green having pushed nothing
to Vercel.

## Prompt

```text
DiveDay's `Infra` workflow's `deploy` job runs `pnpm infra:deploy ... --ci-unattended`, whose
post-deploy wizard shells out to the `gh` and `vercel` CLIs using GH_TOKEN / VERCEL_TOKEN /
VERCEL_ORG_ID / VERCEL_PROJECT_ID, supplied as job env from secrets on the `infra-deploy` GitHub
Environment, each named for the variable it becomes. If any of those lookups resolves to the empty
string -- because the secret is genuinely missing, or because the workflow line reads a name that
does not match the one that was actually stored -- GitHub says nothing, the workflow passes "" to the
CLI, and the run fails minutes later inside `gh` or `vercel` as an authentication error naming no
cause -- and a typo'd name, a secret stored at the wrong scope, and a setup step nobody has done are
all indistinguishable from inside the run. On 2026-08-12 a failed deploy was spent working out which
of those it was, and the answer was never firmly established.

Read first: the `deploy` job in .github/workflows/infra.yml (note its existing "Confirm the deploy
role ARN is set" step, which is exactly the pattern this needs for a different credential),
scripts/post-deploy-wizard.mjs, and ADR 20260811-ci-deploy-full-wizard -- particularly its stated
decision that a failing wizard step exits non-zero rather than being skipped, which this must not
change.

Make the missing credential say so. Prefer a pre-flight step in the workflow, before `pnpm
infra:deploy`, that fails with an ::error:: naming the manual action when a required secret or
variable is empty -- so the run refuses before touching AWS rather than after the stack has already
updated. Do not skip credential-less steps and continue; that is the partial-success shape the ADR
rejects.

Done means: a `command: deploy` dispatch with any of the four unset -- try it by renaming one secret
so the workflow's lookup misses -- fails before `cdk deploy` runs, with a message naming both the
empty variable and the manual action that supplies it. Verify with `pnpm check`
and a focused run of scripts/post-deploy-wizard.test.mjs. Delete
docs/product/follow-ups/FU-20260812-ci-wizard-runs-steps-with-no-credential.md as part of the change.
```
