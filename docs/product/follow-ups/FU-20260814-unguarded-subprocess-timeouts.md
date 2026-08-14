# FU-20260814-unguarded-subprocess-timeouts — Audit remaining `spawn`/`spawnSync` calls in scripts/ for missing timeouts

- **Status:** Open
- **Raised:** 2026-08-14 — cloud-runner-hanging-detection-sz6ypp, after `scripts/check-repo.mjs`
  was seen hanging permanently on a cloud runner mid-command
  (`git add -A drizzle && pnpm check 2>&1 | tail -14`)
- **Kind:** risk
- **Effort:** S
- **Touches:** `scripts/aws-login.mjs`, `scripts/infra-cdk.mjs`, `scripts/infra-bootstrap.mjs`,
  `scripts/infra-deploy.mjs`, `scripts/previous-release-migrations.mjs`,
  `scripts/gate-freshness.mjs`, `scripts/import-vercel-env.mjs`

## What I noticed

`scripts/check-repo.mjs` spawns its 20 `check-*.mjs` scripts concurrently and `await`s all of them
via `Promise.all` with no timeout — if any one check (or a `git`/`spawnSync` grandchild it shells
out to) wedges for any reason, the whole `pnpm check:repo` — and therefore `pnpm check`, and any
cloud-runner command chained after it — hangs forever with no diagnosis. This change (same commit)
fixed that one entry point with a 90s per-check timeout that SIGKILLs the whole process group and
reports which check timed out.

I could not reproduce the original hang locally to identify which specific check (or which `git`
call inside it, e.g. `previous-release-migrations.mjs`'s unguarded `spawnSync("git", args)`) was
responsible — the fix in this change is defensive/structural rather than a root-cause fix for one
script. The same unguarded-subprocess pattern (`spawnSync`/`spawn` with no `timeout` option, no
`AbortSignal.timeout()`) still exists in several other scripts, none of which are on the
`pnpm check` hot path today but which do run on cloud runners or in CI: the AWS/CDK deploy scripts
(`aws-login.mjs`, `infra-cdk.mjs`, `infra-bootstrap.mjs`, `infra-deploy.mjs`) and
`gate-freshness.mjs`/`import-vercel-env.mjs`. Several of these could plausibly block on an
interactive prompt (AWS SSO login, `cdk` confirmation) rather than exit non-zero, which is exactly
the failure mode this change guards against for `check:repo`.

## Why it isn't already done

Out of scope for the immediate ask (unblock `pnpm check` hanging). The deploy scripts run rarely
and mostly outside agent sessions, and blanket-adding timeouts to them without checking whether any
legitimately need more than a few minutes (a real CDK deploy can) risks turning a slow-but-correct
run into a spurious failure — that needs a per-script judgment call, not a mechanical sweep.

## Proposed change

For each `spawnSync`/`spawn` call in the touched files above that has no `timeout` (Node's built-in
`timeout` option on `spawnSync`, or an `AbortController`/`AbortSignal.timeout()` passed to `spawn`)
and isn't already covered by an outer bound: decide a sane ceiling (interactive-login scripts should
fail fast — seconds, not minutes; a real deploy needs a generous one, e.g. 10–15 minutes) and add
it, with a clear stderr message on timeout naming which subprocess wedged, following the pattern
`scripts/check-repo.mjs` now uses (kill the process group, not just the immediate child, so a
`spawnSync` grandchild can't survive as an orphan).

## Prompt

```text
Read scripts/check-repo.mjs's runCheck() (fixed on branch
claude/cloud-runner-hanging-detection-sz6ypp) for the pattern to follow: detached process group,
setTimeout that SIGKILLs the whole group via `process.kill(-child.pid, "SIGKILL")`, and a clear
"timed out after Ns" message on the result.

Then audit scripts/aws-login.mjs, scripts/infra-cdk.mjs, scripts/infra-bootstrap.mjs,
scripts/infra-deploy.mjs, scripts/previous-release-migrations.mjs, scripts/gate-freshness.mjs, and
scripts/import-vercel-env.mjs for spawn/spawnSync calls with no timeout. For each, decide whether it
can legitimately run long (a real CDK deploy) or should fail fast (an AWS SSO login prompt, a git
merge-base lookup), and add an appropriate bound using Node's spawnSync `timeout` option or an
AbortSignal for spawn. Add or update the relevant *.test.mjs for each script to cover the new
timeout path (see check-repo.mjs's manual verification in that commit for one way to simulate a
wedged subprocess with `sleep`).

Run `pnpm check` and the focused tests for each touched script when done. Delete
docs/product/follow-ups/FU-20260814-unguarded-subprocess-timeouts.md as part of the change.
```
