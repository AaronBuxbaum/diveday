# FU-20260812-ci-wizard-runs-steps-with-no-credential — Say which manual action is missing instead of failing inside the gh/vercel CLI

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

All four are empty — the `ci-github-admin-token` and `ci-vercel-deploy-token` manual actions (§17 of
`infra/lib/infra-stack.ts`, rendered into `docs/engineering/manual-actions.md`) have not been done, so
the repository secrets they populate do not exist and the workflow passes through blanks.

The actual failure message was about something else entirely (`Command \`vercel deploy\` requires
confirmation. Use option "--yes" to confirm.`, fixed in the same change as this follow-up). With that
fixed, the *next* CI deploy will reach the same steps and fail again — this time inside the Vercel or
GitHub CLI, with whatever unauthenticated-request error those tools emit, which says nothing about the
manual action that is the real cause. `.github/workflows/infra.yml` already has this exact pattern for
the role ARNs, with a "Confirm the deploy role ARN is set" step that names the manual action; the
wizard's own credentials have no equivalent.

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
   `::error::`-annotated message naming `ci-github-admin-token`/`ci-vercel-deploy-token` when
   `secrets.INFRA_DEPLOY_GH_TOKEN`/`secrets.INFRA_DEPLOY_VERCEL_TOKEN` (or the two `vars.VERCEL_*`)
   are empty. Refuses before touching AWS at all, so a deploy is never half-done for this reason.
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
VERCEL_ORG_ID / VERCEL_PROJECT_ID, supplied as job env from repository secrets and variables. Those
secrets do not exist yet -- the `ci-github-admin-token` and `ci-vercel-deploy-token` manual actions
(section 17 of infra/lib/infra-stack.ts, rendered into docs/engineering/manual-actions.md) have not
been done -- so the workflow passes empty strings and the wizard fails inside the CLI with an
authentication error that never mentions the manual action that is the actual cause.

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

Done means: a `command: deploy` dispatch with the secrets still unset fails with a message naming
`ci-github-admin-token` / `ci-vercel-deploy-token`, before `cdk deploy` runs. Verify with `pnpm check`
and a focused run of scripts/post-deploy-wizard.test.mjs. Delete
docs/product/follow-ups/FU-20260812-ci-wizard-runs-steps-with-no-credential.md as part of the change.
```
