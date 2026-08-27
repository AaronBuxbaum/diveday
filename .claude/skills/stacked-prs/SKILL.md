---
name: stacked-prs
description: Open work as stacked pull requests — the default shape for any branch cut while another of your own branches is still open, related or not, pixels or not. Chained base branches, GitHub stacks, cascading rebase, bottom-up merge. Use when cutting a branch or opening a pull request, when a scope has steps that cannot compile or review independently (schema → db reader → surface), or when asked to review, rebase, or land an existing stack.
---

# Stacked pull requests

A stack is an ordered chain of pull requests in this repository: the bottom targets `main`, each one
above targets the head branch of the one below. GitHub runs the cascading rebase server-side, merges
bottom-up and atomically, and retargets what is left onto `main`
(ADR [20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md)).

## Stack by default

**Cut every branch from the branch you opened last, not from `main`, whenever that one is still
open.** Related or unrelated, a schema migration or a padding change, one file or forty — the shape
is the same, and it is the default rather than a special case for dependent chains (ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md),
"Widened: stack by default"). Two different arguments arrive at that one habit.

**A dependent chain has no other honest shape.** Step 2 cannot compile, test, or be read without
step 1:

- `src/db/schema.ts` + migration → the `src/db` reader → the surface that renders it
- a `src/lib` domain rule → the feature module that composes it → the route
- a refactor that must land before the behaviour change that needs it

Anything else prices it as one unreviewable pull request or a session idling until its own earlier
one merges.

**Unrelated work stacks for a different reason: the conflicts.** A second branch cut from `main`
re-edits the same shared files as the first — `AGENTS.md`'s `check:repo` row, a `docs/design/*.md`
section, a `scripts/*-baseline.json`, a message bundle — and each one is a merge resolved later, by
hand, without the context that produced it. Thirteen branches cut from one `main` in a single
session is the measured case, and every one of them conflicted with every other. On a stack each
layer already contains the layers below, so those files merge **once, while the change is being
written**. The ratchets are the sharpest version: a baseline written on layer 4 already counts layer
3's work, so `--absorb` is left for genuine merges from outside the stack rather than for your own
previous branch.

**A layer that moves pixels is a layer like any other.** That restriction was lifted on 2026-08-23
(Aaron's call, issue #905) once the trade was measured: losing the baseline race costs a **re-read,
not a missed regression**, and the pipeline now names each layer's baseline key and waits for the
layer below to publish it (issue #909). What replaces the restriction is the reading discipline
under *What our pipeline does with it* below — never a reason to cut from `main` instead.

### What still goes on its own branch off `main`

1. **Nothing of yours is open.** `git fetch origin main` first, every time: if the branch below has
   merged, the next one cuts from the refreshed `origin/main` and there is no stack at all.
2. **A fix that must merge now** — a red `main`, a hotfix, a race in a spec you did not touch found
   while triaging someone else's diff. It should be able to merge without waiting for the layers
   beneath it.
3. **The stack is about six layers deep.** Every layer pays lint, typecheck, four unit shards, a
   build and eight Playwright/visual shards, and pays again above every cascading rebase. Past
   roughly six the wall-clock cost outweighs the conflicts it saves: start a new stack.
4. **The branch below belongs to another session.** Stack on your own work. Someone else's
   force-push is your cascading rebase, and their claim is not yours to extend.

## Building the chain

A session does both halves itself: it builds the **shape** — the chained branches and pull requests —
and then registers that shape as a stack. The shape is the whole substance; registering adds the
cascading rebase and the group merge on top of it.

```sh
git fetch origin main                                  # first, every time — it decides the shape

# layer 1: nothing of yours is open, so cut from the refreshed main
git checkout -b claude/<slug>-1-schema origin/main
# ... first commit ...

# layer 2, cut from layer 1 — not from main, whether or not it depends on layer 1
git checkout -b claude/<slug>-2-reader claude/<slug>-1-schema
# ... first commit ...

# push both, open whichever pull requests are missing, register the stack — one command
gh stack link claude/<slug>-1-schema claude/<slug>-2-reader
```

**Open and register a layer at its first commit, not when its work is finished.** That is the whole
of the discipline, and it is what the rest of this file assumes. `gh stack link` pushes each branch,
reuses an open pull request where one exists and opens a **draft** where none does, chains the bases
in the order given, and creates or extends the stack — so there is no `gh pr create --base <branch>`
left to run hours later, against a branch that may no longer be there.

Measured on 2026-08-23 in a throwaway four-layer stack (ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md),
"register at the first commit"): merging the bottom layer deleted its branch and GitHub **silently
retargeted the layer above onto the new base** — no timeline event, nothing to do, the pull request
stayed open and its diff stayed honest. Run the same moment by hand and it fails outright:

```
$ gh pr create --base claude/<slug>-1-schema --head claude/<slug>-2-reader
No commits between claude/<slug>-1-schema and claude/<slug>-2-reader, Base ref must be a branch
```

which is exactly what PR #893 recorded as a reason to stop stacking. The failure lives entirely in
the gap between cutting a branch and opening its pull request; closing that gap removes it.

Where the extension is not available — a cloud session, where installing it 403s — the same
discipline is `gh pr create --base <branch> --draft` at the first commit plus the REST call below.
Either way, every body states its position and what is beneath it, because a reviewer who lands on
layer 3 from a notification has no other way to find the bottom:

```
Layer 2 of 3 — based on `claude/<slug>-1-schema` (#641). Above: `claude/<slug>-3-surface` (#643).
Review and merge bottom-up.
```

Then say in the closing message that the chain is ready to register, listing the numbers bottom to
top. Do not leave that in a comment on one of the pull requests only — see AGENTS.md's rule about
queues that live in a message.

## Registering and driving the stack

Register with `gh api`, which needs no extension and works wherever `gh` does — including cloud
sessions, where `gh` is pre-installed and the GitHub proxy substitutes credentials on outbound
requests, so there is no `gh auth login` step:

```sh
# register existing chained-base PRs, bottom to top — -F, never -f
gh api --method POST repos/{owner}/{repo}/stacks -F 'pull_requests[]=641' \
  -F 'pull_requests[]=642' -F 'pull_requests[]=643'

gh api repos/{owner}/{repo}/stacks                    # list stacks and their layers
gh api --method POST repos/{owner}/{repo}/stacks/{n}/add -F 'pull_requests[]=644'  # extend
gh api --method POST repos/{owner}/{repo}/stacks/{n}/unstack # dissolve
```

**`-f` does not work and this file said `-f` until 2026-08-23.** `gh api -f` sends every value as a
string, and the endpoint types `pull_requests` as integers:

```
422 Invalid property /pull_requests/0: `"641"` is not of type `integer`
```

A session following the old form got that 422, concluded the write path was unavailable, and fell
back to hand-chained `gh pr create --base` — which is the likeliest reason PR #893 met the
vanished-base failure at all. `-F` sends typed values and is the only difference.

`pull_requests` is ordered bottom to top and takes 2–100 entries. GraphQL is read-only (`stack`,
`stackEntry` on `PullRequest`) — and in a cloud session the proxy serves only a pinned set of
GraphQL operations, so reach for the REST forms above rather than GraphQL. A `404` means the preview
is not enabled for the repository.

Three refusals to expect, all of them GitHub protecting the stack rather than a broken command:

- **`gh pr merge` cannot merge a stacked pull request.** *"This pull request is part of a stack and
  must be merged using the asynchronous merge REST API."* Use `gh stack merge <pr-or-stack> --yes`,
  which merges everything up to and including that pull request in one all-or-nothing operation.
- **`gh pr edit --base` is refused on a stacked pull request.** *"Cannot change the base branch
  because the pull request is part of a stack."* GitHub owns those refs — which is precisely what
  makes the retarget-on-merge above something you can rely on instead of watch for.
- **`gh stack link` retargets the bottom pull request to the repository's default branch.** Silent,
  and harmless for every real stack, since the bottom targets `main` anyway. The REST endpoint will
  root a stack on any branch, which is what a throwaway experiment wants and what `link` will undo.

One thing to do by hand: a branch cut from a layer *before* that layer merged, and attached *after*,
still carries the pre-merge parent commit, so its pull request diff duplicates the merged layer's
files. `gh stack merge` cascade-rebases the branches that were in the stack, not that one. Rebase it
onto the new top — `git rebase --onto <top> <old parent sha> <branch>` — and the diff comes back to
its own change.

The `github/gh-stack` extension wraps the same REST endpoints (`gh stack link`, `view`, `sync`,
`merge`) and is the shortest path on a workstation. Do **not** rely on it in a cloud session:
installing an extension pulls a release asset from another repository, and the GitHub proxy scopes
release-asset requests to repositories attached to the session, so the install is expected to 403.
There, do the same thing in two calls: `gh pr create --base <branch> --draft` at the layer's first
commit, then the `POST .../stacks` above.

## What our pipeline does with it

- **CI runs in full on every layer, but not all at once: the bottom goes first, the top next, the
  middles last.** `.github/workflows/ci.yml` triggers on a bare `pull_request:` with no branch
  filter, so a base of `claude/<slug>-1-schema` still gets the identical gate — what changed on
  2026-08-27 is the *order*. A `stack-priority` job reads this layer's place in the stack and, for a
  middle layer, holds its lint, typecheck, unit and Playwright jobs until the bottom and the top
  have finished theirs (ADR
  [20260827-stack-ci-priority](../../../docs/architecture/decisions/20260827-stack-ci-priority.md)).
  Three things follow, and only the first is something to do:

  1. **A middle layer's checks can sit "Expected" for a while.** That is the gate working, not a
     stuck run — the job log says which layers it is waiting for. It is capped at 40 minutes, after
     which the layer runs regardless, and it is a *yield*: every layer still runs its full gate,
     because branch protection evaluates checks per pull request and a layer that never ran cannot
     merge.
  2. **The visual path never yields.** `build`, `visual` and `visual-report` run at once on every
     layer, because the layer above is keyed to this one's snapshot — deferring them would deadlock
     the top against the middle beneath it. So everything under *Rebase a layer before you read its
     visual report* below is unchanged.
  3. **Nothing about it can redden or remove a check.** A 404 from the stacks preview, a fork's
     read-only token, its own deadline: the gate opens and CI behaves as it did before.
- **`pnpm test:changed` and the destructive-migration guard** anchor on
  `git merge-base origin/main HEAD`, which in a stack is the fork point of the whole stack. Upper
  layers re-run lower layers' affected tests and re-check their migrations. Slower, never wrong —
  do not "fix" it by re-anchoring to the layer below.
- **Visual regression handles a stack on its own, and a stack may move pixels.** Two things make
  that true. First, the baseline key is *named* rather than inferred: `regconfig.json` uses
  `reg-simple-keygen-plugin` and `scripts/reg-suit-keys.mjs` resolves a layer's baseline to
  `git merge-base origin/<base ref> HEAD` — the layer below's head, which is what makes each layer's
  diff show only its own pixels rather than everything beneath it. Second, an explicit key cannot
  conjure a snapshot, so a stacked layer's `visual-report` job **waits** for the layer below to
  finish publishing before it compares (`scripts/wait-for-baseline.mjs`): up to 20 minutes, only
  when the base is not `main`, and never a reason for a red run. The wait-and-re-run this file used
  to ask of you is what the pipeline now does (ADR
  [20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md),
  "the baseline is named rather than inferred"; issue #909).

  Two of the three obligations that replaced the old restriction still stand, because they are about
  reading rather than about the race:

  1. **Read the sticky `diveday:visual-summary` comment on the layer you are triaging.** If it says
     nothing was compared, nothing was compared: that layer's counts mean **unknown**, never "no
     visual changes" (see the **visual-triage** skill). That is now the exception rather than the
     expectation — it means the wait gave up, so the layer below's own visual jobs are red or were
     still running twenty minutes on. Fix those, re-run this layer's `visual-report`, read the
     refreshed comment.
  2. **Never merge a layer whose pixels were never compared** on the grounds that the count was
     zero. Zero-changed with zero baselines is the failure, not the pass.
- **Rebase a layer before you read its visual report.** A branch whose parent has fallen behind
  `main` compares against that *parent*, while CI captures the pull request *merged with `main`* —
  so every commit merged in between shows up as your diff. That is not a stack-specific bug, but a
  stack is where a stale parent is most likely: PR #668 reported 60 changed surfaces of which 39
  belonged to other people's merged work, and rebasing cut it to 21.

## Answering review across layers

Every layer is reviewed on its own — `sourcery-ai` and `coderabbitai` comment on each one as it
opens, so a six-layer stack collects six reviews while you are still building the top of it. Read
them per layer, on the same pass that reads each layer's CI:

```sh
gh pr list --author '@me' --state open --json number,title,mergeable,statusCheckRollup
gh pr view <n> --comments
```

**Answer a comment on the layer that owns the code, never the layer you are standing on.** The
rule is the one that governs a red check in a stack, for the same reason: a stack merges bottom-up,
so a fix committed above the layer being commented on arrives *after* that layer has already merged
without it. Fix at the owning layer, then cascade — `gh stack sync --prune`, or rebase each layer
above onto the one below.

Each thread ends in a state: fixed and replied to with the commit, declined with the reason, or
filed as a `needs-triage` issue whose number is in the thread. Commit whatever you are holding at
the top of the stack before you go down (never `git stash` — AGENTS.md's *Parallel work*).

## Landing it

Merge bottom-up; merging a middle layer merges everything below it in one atomic operation, and the
layers above retarget themselves. After each merge, `gh stack sync --prune` (or the pull request's
own rebase control) brings the rest forward. A layer that goes red after a cascading rebase is
ordinary red CI and belongs to whoever owns the stack — AGENTS.md's rule that a failing test is part
of the work applies per layer.

## Claiming

One claim covers the whole stack, not one per layer. Post the `## Claim` comment on the issue with
the **bottom** branch as `Branch:` and name the layers you intend to open — see
[docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s "Claiming an issue". Three
half-claimed branches with no stated order is exactly the state that convention exists to prevent.
