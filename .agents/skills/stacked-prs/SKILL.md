---
name: stacked-prs
description: DiveDay's cross-thread stack policy: branch from the newest open layer, run CI at the top, and publish through gh stack. Use when creating, publishing, or landing a layer.
---

# Stacked pull requests

A stack is one linear chain of pull requests: the bottom targets `main`, each one above targets the
head branch of the one below. Aaron sets threads on varied work, comes back, and clicks **Merge** on
the top PR: GitHub merges every layer up to it, all or nothing. Registering and moving the chain is
`gh stack` (ADR [20261105-gh-stack-is-the-stack](../../../docs/architecture/decisions/20261105-gh-stack-is-the-stack.md)).

## The rule

**Stack everything, across threads: cut every branch from the newest open one, any thread's,
related or not.** A dependent chain has no other honest shape, and unrelated work stacks because a
second branch cut from `main` re-edits the same shared files (a `check:repo` row, a baseline, a
message bundle) and conflicts later, by hand. Only two cases go off `main`: **no stack is open**
(`git fetch origin main` first, every time), or **a fix that must merge now**. There is no maximum
depth.

**CI runs on the top layer only** (ADR [20261105-ci-runs-on-the-top-of-the-stack](../../../docs/architecture/decisions/20261105-ci-runs-on-the-top-of-the-stack.md)):
the account has a fixed number of runners and Aaron merges the whole stack from the top, so
`stack-gate` in `ci.yml` skips every lower layer, and a slice of CI across layers never happens.
A lower layer shows skipped checks, which are not green; label it `ci-now` and re-run (or push) to run CI there when the top is red and Aaron wants to merge up to it. Fix a red top from the top; do not hold a
push for the layer below.

## Commands

Always non-interactive: pass `-m` and `--auto` and read stdin from `/dev/null`, or `gh stack` opens
an editor.

```sh
git fetch origin main
gh stack init <first-branch>                 # only when no stack is open; trunk defaults to main
gh stack add -Am "<message>" <branch> </dev/null   # a layer on top, never anywhere else
gh stack submit --auto </dev/null            # push, open draft PRs with the right bases, register the stack
gh stack link <pr> <pr> <pr>                 # adopt PRs that already exist; append by stack number
gh stack rebase                              # bring the layers forward, cascading from the bottom
gh stack push                                # force-with-lease; plain `git push` is refused after a rebase
```

- **Forks are impossible:** `gh stack add` refuses a non-top layer. A second thread starting from
  the same base goes on top instead.
- **A conflict** stops the rebase mid-way and names the files: `git add`, then
  `gh stack rebase --continue` (`--abort` backs out).
- **After merging a layer up** run **`pnpm regen`** and commit what it changed before you push.
- **Never `gh pr edit --base`** on a stacked PR (GitHub refuses), and never close a layer with
  `--delete-branch`: it closes the layer above and leaves a stray stack record.
- **`gh stack submit` leaves empty PR bodies.** Right after it, `gh pr edit` each body with its
  position line ([position.md](position.md)) and the repository's PR body rows.
- Merging is `gh stack merge <pr> --yes`, or the Merge button on the top PR. It checks only that
  each PR is open and not a draft; GitHub enforces protections. Merging is Aaron's.

## Reference

- [position.md](position.md) — finding your layer, the top and any other tip from git (`node scripts/stack-map.mjs`); the position line every PR body carries.
- [review.md](review.md) — a review comment on a stacked layer: answer it on the layer that owns the code.

## Claiming and closing

Claims follow the issue, not the stack: [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s
"Claiming an issue" says which branch a claim names. Each layer's body lists `Closes #n`, one per
line under "## Follow-ups filed", for every issue whose claim names that layer's branch;
`scripts/check-pr-body.mjs` refuses the body without it.
