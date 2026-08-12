# 20260811-deploy-gate-runs-fresh-diff — Run `cdk synth`+`diff` inside the same `workflow_dispatch` run as `deploy`, before the reviewer-approval gate

- **Status:** Accepted
- **Date:** 2026-08-11
- **Amends:** [20260808-github-actions-cdk-diff-deploy](20260808-github-actions-cdk-diff-deploy.md) — its
  Decision and Consequences describe the `diff` job as running "only on `workflow_dispatch` with
  `command: diff`", mutually exclusive with `command: deploy`. That claim is withdrawn; everything
  else in that record (the two-role split, the trust conditions, the required-reviewer gate itself)
  is unchanged.

## Context

`diff`'s condition only matched `inputs.command == 'diff'`, and `deploy` carried no `needs: diff` —
so dispatching `command: deploy` never ran `cdk synth`/`cdk diff` in that run. The `infra-deploy`
environment's required reviewer approved with nothing but the workflow's own history in front of
them; the only diff review that had actually happened was whatever `pull_request`-triggered `diff`
job comment landed on the PR that introduced the change, which does not cover drift on `main` since
that PR merged, or a dispatch run from a non-`main` ref.

## Decision

`diff`'s `if` now also matches `inputs.command == 'deploy'`, and its `cdk diff` step (already
`if: github.event_name == 'workflow_dispatch'`, so it already covered both commands once reachable)
is unchanged in behavior. `deploy` gets `needs: diff` plus `needs.diff.result == 'success'` added to
its own `if` — a job's own `if:` fully replaces the default success-gating a bare `needs:` would
otherwise imply, so this is required for a broken synth/diff to actually block the deploy rather than
just delay it. Net effect: a `command: deploy` dispatch now always synths and diffs first, in the same
run, and the reviewer sees that output before the environment-approval prompt.

`diff`'s `cdk diff` step also switched from `pnpm exec cdk diff` to `pnpm infra:diff`
(`scripts/infra-cdk.mjs diff`) — the command a workstation operator actually runs, matching how
`deploy` already runs `pnpm infra:deploy` rather than a bare `cdk deploy`. This is a no-op in CI:
`selectDeployProfile` short-circuits because `configure-aws-credentials` already exported
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, and `ensureAwsDeploymentLogin`'s `aws sts
get-caller-identity` check passes immediately against those already-valid credentials (interactive
login is never attempted: GitHub Actions sets `CI=true` for every job, which `infra-cdk.mjs` reads as
`interactive: false`). The `cdk synth --quiet` step deliberately keeps `pnpm exec cdk synth`, not
`pnpm infra:synth`: it runs before `configure-aws-credentials`, by design, so a broken template fails
loudly even before any AWS role is configured (20260808's stated consequence). `infra-cdk.mjs` does
not distinguish synth from diff — it unconditionally requires a working AWS login — so routing synth
through it would turn that credential-free check into a hard requirement.

## Alternatives considered

- **Leave diff review at PR-merge time only**, treating the reviewer-approval click as sufficient on
  its own. Rejected: 20260808 already named this as the intended review point, but a dispatch can run
  against `main` well after the PR merged (further merges since, or infra state drifted outside a
  reviewed PR), and `workflow_dispatch` explicitly allows picking any ref — the approval was gating
  "a human clicked twice," not "a human saw what this specific run will change."
- **Require a separate, prior `command: diff` dispatch before allowing `command: deploy`.** Rejected:
  unenforceable from the workflow file itself (nothing ties one dispatch to a later one), and strictly
  worse ergonomics than folding it into the same run for no safety gain.

## Consequences

A `command: deploy` dispatch now takes marginally longer (one more sequential job) and costs one more
`cdk synth`+`cdk diff` invocation, in exchange for the reviewer-approval prompt always following a
fresh, same-run diff. A `cdk synth` failure or a `cdk diff` failure now hard-stops the deploy instead
of leaving that only weakly connected to the outcome.

Escape hatch: if the extra sequencing proves unnecessary friction for a solo operator, reverting is
two one-line changes — drop `|| inputs.command == 'deploy'` from `diff`'s `if`, and drop `needs: diff`
plus the `needs.diff.result` clause from `deploy`'s `if`.
