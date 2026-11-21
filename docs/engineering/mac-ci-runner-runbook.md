# Mac CI runner runbook

CI's lint, typecheck, repository safeguards and unit tests run on Aaron's Mac whenever one of its runners is online, and on GitHub's runners when none is. Nobody switches anything: the `changes` job in `.github/workflows/ci.yml` asks GitHub which runners are online at the start of every run (`scripts/ci-runner-pick.mjs`) and sends those jobs to the Mac or to GitHub's `ubuntu-24.04` (the one image `scripts/check-runner-image.mjs` pins). ADR [20261013-mac-ci-runner](../architecture/decisions/20261013-mac-ci-runner.md) records why.

## Why

The account is on GitHub Pro, which runs 40 GitHub-hosted jobs at once. A full CI run is 23 jobs, and a stack of pull requests asks for far more than 40, so on 2026-10-12 a job waited a median 6.5 minutes for a runner (33 minutes at the 90th percentile) and a run that takes 15 to 20 minutes alone took 45 to 100. Every job the Mac takes hands a slot back to the jobs that must stay on GitHub. Cost comparison: `/mnt/project-files/ci-runners/2026-10-12-ci-runner-costs.md` in the project files.

## What runs where

| Job | Where |
| --- | --- |
| Repository safeguards, Lint, Typecheck, Unit tests shards 1–4, Unit tests that read docs | The Mac when it is online, else GitHub |
| Detect what changed | GitHub (it makes the choice) |
| Build, Playwright, Plan the visual captures, Visual capture, reg-suit | GitHub. Screenshots are compared against GitHub-rendered baselines, and the build feeds them |
| Real Postgres | GitHub (it needs a service container) |

The picker only sends this repository's own branches and pushes to `main` to the Mac. That is routing, not a security boundary: a pull request from a fork can rewrite the workflow and the picker, and ask for the Mac directly. **What keeps a stranger's code off the Mac is the repository setting in step 1 below**, which holds every outside contributor's run until someone approves it. Before approving one, read its changes to `.github/` and `scripts/`.

## One-time setup

1. At https://github.com/AaronBuxbaum/diveday/settings/actions, under "Approval for running fork pull request workflows from contributors", choose **Require approval for all external contributors**. Do this before starting any runner.
2. Install Docker Desktop or OrbStack and start it. Give it at least 8 GB of memory for four runners.
3. Make a fine-grained token for the Mac at https://github.com/settings/personal-access-tokens/new: repository access "Only select repositories" → `AaronBuxbaum/diveday`, permission "Administration: Read and write". Save it on the Mac:

```
mkdir -p ~/.config/diveday && pbpaste > ~/.config/diveday/runner-token && chmod 600 ~/.config/diveday/runner-token
```

4. Make a second fine-grained token for CI with the same repository and "Administration: Read-only", and add it as the repository secret `CI_RUNNER_STATUS_TOKEN` at https://github.com/AaronBuxbaum/diveday/settings/secrets/actions. CI only reads which runners are online with it. Without it, every job runs on GitHub.

## Starting and stopping

From the repository on the Mac:

```
scripts/mac-runner/start.sh
```

Leave the window open. Ctrl-C stops the runners, and the next CI run goes back to GitHub. `RUNNERS=2 scripts/mac-runner/start.sh` runs fewer.

Each runner is a fresh container that takes one job and is deleted, then a new one registers. A job runs as an unprivileged user with sudo turned off, with 4 GB of memory and 2 CPUs (`MEMORY=6g CPUS=3` change them). The only thing jobs share is the pnpm package store, a Docker volume (`diveday-runner-pnpm`) that the script wipes every time it starts, so packages are downloaded once per session rather than once per job.

## When something goes wrong

- **Send everything to GitHub without touching the Mac:** set the repository variable `MAC_RUNNER` to `off` at https://github.com/AaronBuxbaum/diveday/settings/variables/actions. Delete it to turn the Mac back on.
- **The Mac went to sleep in the middle of a run.** Jobs it had already been given wait for it to wake, and a job that was running fails when GitHub loses the runner. Re-run the failed jobs. The next run starts on GitHub if the runners are still offline.
- **A job passes on GitHub and fails on the Mac.** The Mac's runners are Linux on Apple silicon (arm64); GitHub's are x64. Turn the Mac off with `MAC_RUNNER`, then file a `needs-triage` issue naming the job.
- **"GitHub refused a registration token."** The Mac's token expired or lost its permission. Make a new one (step 3).
