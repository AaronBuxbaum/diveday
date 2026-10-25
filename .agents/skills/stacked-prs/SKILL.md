---
name: stacked-prs
description: Open work as stacked pull requests — chained bases, cascading rebase, bottom-up merge, one PR's CI at a time. Use when cutting a branch or opening a PR while any stack is open, or pushing, rebasing, or landing one.
---

# Stacked pull requests

A stack is an ordered chain of pull requests in this repository: the bottom targets `main`, each one
above targets the head branch of the one below. GitHub runs the cascading rebase server-side, merges
bottom-up and atomically, and retargets what is left onto `main`
(ADR [20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md)).

## The rule

**Stack everything, across threads, and run one PR's CI at a time: cut every branch from the
newest open one, any thread's, related or not, as a draft with `base` on it; the thread that owns
the stack pushes one layer at a time, because overlapping runs queue on a 20-job cap** (AGENTS.md's
*Parallel work*). Pixels and depth are not exceptions. Only two cases go on their own branch off
`main`: **no stack is open** (`git fetch origin main` first, every time), or **a fix that must
merge now**. After merging a layer up, run **`pnpm regen`** and commit what it changed before you
push. **Merge the layer below once its CI is green**, not while it is red: a red layer merged up is
a red run on every layer above, unless your layer carries the fix. The reasoning and the measured incidents are in [why.md](why.md).

**`pnpm stack:sync`** does the merge: it reads the open chain from GitHub and merges this layer's
base (`origin/main` for the bottom) into it, stops on a conflict with the files named, and pushes
nothing; it prints the next commands (`pnpm regen`, `git push`) and
what each layer above does after. `--plan` changes nothing; `--chain` walks every layer bottom
first, only in local worktrees that already hold the branch and are clean. A red layer below gets
a loud banner from `verify:push` naming its branch: fix it there first.

## Building the chain

A session builds the **shape** and only the shape: the chained branches and the pull requests on
them. Registering that shape as a stack — which is what adds the cascading rebase and the bottom-up
atomic merge on top of it — happens on a runner, off the pull request event
(`.github/workflows/stack.yml`, ADR
[20260907-a-runner-registers-the-stack](../../../docs/architecture/decisions/20260907-a-runner-registers-the-stack.md)).
There is nothing for you to run and nothing to wait for.

```sh
git fetch origin main                                  # first, every time — it decides the shape

# layer 1: nothing of yours is open, so cut from the refreshed main
git checkout -b claude/<slug>-1-schema origin/main
# ... first commit ...
git push -u origin claude/<slug>-1-schema
# open its pull request now, as a draft, base `main`

# layer 2, cut from layer 1 — not from main, whether or not it depends on layer 1
git checkout -b claude/<slug>-2-reader claude/<slug>-1-schema
# ... first commit ...
git push -u origin claude/<slug>-2-reader
# open its pull request now, as a draft, base `claude/<slug>-1-schema`
```

**Open a layer's pull request at its first commit, not when its work is finished.** That is the
whole of the discipline now, and the rest of this file assumes it. It is also the only part that has
ever gone wrong: measured on 2026-08-23 (ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md),
"register at the first commit"), merging the bottom layer deleted its branch and GitHub **silently
retargeted the layer above onto the new base** — no timeline event, nothing to do, the pull request
stayed open and its diff stayed honest. Run the same moment by hand and it fails outright:

```
$ gh pr create --base claude/<slug>-1-schema --head claude/<slug>-2-reader
No commits between claude/<slug>-1-schema and claude/<slug>-2-reader, Base ref must be a branch
```

which is exactly what PR #893 recorded as a reason to stop stacking. The failure lives entirely in
the gap between cutting a branch and opening its pull request; closing that gap removes it.

## Reference

Read the file whose case is in front of you:

- [why.md](why.md) — the full rule and its reasoning; what still goes off `main`; depth; merging a layer up (`pnpm regen`); pixel-moving layers.
- [position.md](position.md) — finding your layer, the top and any fork from git (`node scripts/stack-map.mjs`); the position line every PR body carries.
- [pipeline.md](pipeline.md) — how `.github/workflows/stack.yml` registers the stack, why a session never does, the refusals of `gh pr merge` / `gh pr edit --base`, and what CI, the migration guard and visual regression do per layer.
- [review.md](review.md) — a review comment on a stacked layer: answer it on the layer that owns the code.

## Landing it

Merging is the human's, here as everywhere. It goes bottom-up; merging a middle layer merges
everything below it in one atomic operation, GitHub cascade-rebases what is left and the layers
above retarget themselves — that server-side cascade is precisely what registering bought, and it
is why nothing has to bring the rest forward by hand. A layer that goes red after a cascading
rebase is ordinary red CI and belongs to whoever owns the stack — AGENTS.md's rule that a failing
test is part of the work applies per layer.

## Claiming

Claims follow the issue, not the stack: [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s
"Claiming an issue" says which branch a claim names.

## Closing what you claimed

Each layer's body lists `Closes #n`, one per line under "## Follow-ups filed", for every issue whose
claim names that layer's branch; `scripts/check-pr-body.mjs` refuses the body without it.
