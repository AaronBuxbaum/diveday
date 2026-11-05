---
name: stacked-prs
description: Open work as stacked pull requests with gh stack — chained bases, one-click merge of the whole stack, CI fixed from the top. Use when cutting a branch or opening a PR while any stack is open, or pushing, rebasing, or landing one.
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

**Fix CI from the top.** Only the top layer has to pass. A red lower layer is not a blocker, its
runs may be cancelled, and the more of the bottom that passes the better, since Aaron can merge up
to any layer. Do not hold a push for the layer below.

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
