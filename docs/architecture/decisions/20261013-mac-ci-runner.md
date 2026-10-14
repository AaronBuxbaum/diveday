# 20261013-mac-ci-runner — CI's non-browser jobs run on the owner's Mac when it is online

- **Status:** Accepted 2026-10-13 (Aaron Buxbaum, in the project thread: "It should just consider my Mac's runners for only relevant jobs (not playwright) and should automatically adapt depending on if my Mac is available or not")
- **Date:** 2026-10-13

## Context

The repository is public on a GitHub Pro account: GitHub-hosted runners are free, but at most 40 jobs run at once, and a stack of pull requests asks for far more, so runs spent most of their time queued (measurements in the [runbook](../../engineering/mac-ci-runner-runbook.md#why)). Paid runners were too expensive for the owner, who asked to run CI on their own Mac instead.

## Decision

**Repository safeguards, lint, typecheck and the unit jobs run on the owner's Mac whenever one of its runners is online, and on `ubuntu-latest` otherwise.**

- The `changes` job lists the repository's runners with a read-only token (`CI_RUNNER_STATUS_TOKEN`) and sets `runner`; each of those jobs reads it in `runs-on` (`scripts/ci-runner-pick.mjs`). Every failure, a missing token included, answers GitHub.
- The picker only sends a push to `main` or a pull request from this repository's own branches. That is routing, not the security boundary: a fork's pull request can rewrite the workflow. **The boundary is the repository setting "Require approval for all external contributors"**, which the runbook makes step 1 of setup.
- The runners are ephemeral containers from GitHub's own image (`ghcr.io/actions/actions-runner:latest`, trusted as GitHub's), one job each, started by `scripts/mac-runner/start.sh`, with sudo off (`no-new-privileges`), every capability dropped, and memory, CPU and process limits. The Mac's admin token never enters a container; the one-hour registration token is unset before the job runs. Jobs share only the pnpm store volume, wiped at every start.
- The build, Playwright, visual and reg-suit jobs stay on GitHub: visual captures are compared against GitHub-rendered baselines, and an arm64 build would feed them different bytes. `real-postgres` stays because it needs a service container.
- The repository variable `MAC_RUNNER=off` sends everything to GitHub.

## Alternatives considered

- **Move the browser shards too.** Screenshots taken on another platform differ from the baselines, so every capture would read as a diff.
- **A fixed label with no availability check.** Jobs would wait for a Mac that is asleep.

## Consequences

- With the Mac online, 8 of a run's 23 jobs leave GitHub's 40-job pool.
- Those jobs now wait for `changes` (about 10 seconds plus its own queue) before starting.
- The Mac's runners are arm64 Linux; GitHub's are x64. A test that depends on the architecture can pass on one and fail on the other.
- A job handed to the Mac just before it sleeps waits for it to wake, or fails when GitHub loses the runner; re-running it lands on GitHub.
- The PGlite template cache key now names the architecture, so the Mac and GitHub keep separate snapshots.
- Runbook: [docs/engineering/mac-ci-runner-runbook.md](../../engineering/mac-ci-runner-runbook.md).
