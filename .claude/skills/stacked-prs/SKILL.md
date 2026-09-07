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

Every body states its position and what is beneath it, because a reviewer who lands on layer 3 from
a notification has no other way to find the bottom:

```
Layer 2 of 3 — based on `claude/<slug>-1-schema` (#641). Above: `claude/<slug>-3-surface` (#643).
Review and merge bottom-up.
```

## Registration, which is not yours to do

`.github/workflows/stack.yml` fires on every same-repository pull request event, walks the chain of
open pull requests through the one that fired — down through base refs to `main`, and up again —
and registers it, or extends the stack that already holds its bottom. So layer 1 alone registers
nothing (a chain of one is not a stack), layer 2 opening creates the stack, and every layer after
that extends it.

It is a runner rather than the session because **a session cannot reach the endpoint at all.**
Measured on 2026-09-07: `gh` is not installed, and `api.github.com` answers every repo-scoped
request with `403 "GitHub access is not enabled for this session"` with or without an
`Authorization` header. The GitHub MCP server is a session's only writable path and has no stack
endpoints. Anything you read elsewhere about running `gh api --method POST .../stacks` yourself
describes an environment that no longer exists — it is what silently stopped this repository
registering anything between 2026-08-28 and 2026-09-07, while the chains themselves kept working.

Three things to know, and none of them is a step:

- **Registration is asynchronous.** Reading `stack` on a pull request in the same breath as opening
  it gives `null`. The workflow's run summary says what it did; read that rather than racing it.
- **A refusal is quiet and deliberate.** The registrar acts on a linear chain and nothing else — a
  fork, a cycle, two open pull requests sharing a head branch, or layers spread across two stacks
  are each named in the job log and left alone, because a stack is an *ordered* list that merges
  bottom-up and atomically, so a guessed order is first noticed as the wrong pull request having
  landed. If a chain of yours has not become a stack, that log says why.
- **Nothing here dissolves one.** `POST /repos/{owner}/{repo}/stacks/{n}/unstack` is a human's call
  and leaves ordinary chained-base pull requests behind.

On a workstation, where `gh` exists and is authenticated, the same endpoints are reachable directly
and `gh stack link` / `view` / `sync` / `merge` wrap them. `gh api` needs `-F`, never `-f`: `-f`
sends every value as a string and `pull_requests` is typed as integers, which returns
`422 Invalid property /pull_requests/0: "641" is not of type integer`.

Two refusals to expect from GitHub on a registered stack, both of it protecting the stack rather
than a broken command:

- **`gh pr merge` cannot merge a stacked pull request.** *"This pull request is part of a stack and
  must be merged using the asynchronous merge REST API."* `gh stack merge <pr-or-stack> --yes`
  merges everything up to and including that pull request in one all-or-nothing operation.
- **`gh pr edit --base` is refused on a stacked pull request.** *"Cannot change the base branch
  because the pull request is part of a stack."* GitHub owns those refs — which is precisely what
  makes the retarget-on-merge above something you can rely on instead of watch for.

One thing still to do by hand: a branch cut from a layer *before* that layer merged, and attached
*after*, still carries the pre-merge parent commit, so its pull request diff duplicates the merged
layer's files. The cascading rebase moves the branches that were in the stack, not that one. Rebase
it onto the new top — `git rebase --onto <top> <old parent sha> <branch>` — and the diff comes back
to its own change.

## What our pipeline does with it

- **Only the bottom and the top layer run the expensive gate; the middles skip it.**
  `.github/workflows/ci.yml` triggers on a bare `pull_request:` with no branch filter, so a base of
  `claude/<slug>-1-schema` gets the identical gate offered to it — but a middle layer skips
  `check:repo`, lint, typecheck, the unit shards and the Playwright shards, on a condition read
  straight out of `github.event.pull_request.stack` (ADR
  [20260827-stack-ci-skips-the-middle-layers](../../../docs/architecture/decisions/20260827-stack-ci-skips-the-middle-layers.md),
  superseding 20260827-stack-ci-priority's runner-holding yield). Three things follow, and only the
  first is something to do:

  1. **A middle layer's checks read "Skipped", and GitHub counts a skip as success.** So a green
     middle layer means *nothing ran*, never *nothing is wrong* — read the bottom's and the top's
     runs instead. Every layer does get its own full gate eventually, at the moment it becomes the
     bottom: the cascading rebase force-pushes it, which fires `synchronize`. That only happens if
     you **merge a layer at a time**; one atomic `gh stack merge` from the top lands the middles
     ungated.
  2. **The visual path never skips.** `build`, `visual` and `visual-report` run on every layer,
     because the layer above is keyed to this one's published snapshot — skipping them would leave
     the top with no baseline, reporting every surface as new. So everything under *Rebase a layer
     before you read its visual report* below is unchanged.
  3. **A fork's pull request always runs in full.** `stack` is populated only for a pull request
     somebody with write access registered in a stack, so an unregistered one reads `null` — which
     is the *run* branch. Every shape the condition does not recognise fails open into the gate.
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

Every layer is reviewed on its own — `sourcery-ai` comments on each one as it
opens, so a six-layer stack collects six reviews while you are still building the top of it. Read
them per layer, on the same pass that reads each layer's CI:

```sh
gh pr list --author '@me' --state open --json number,title,mergeable,statusCheckRollup
gh pr view <n> --comments
```

In a cloud session, where `gh` is absent, those are the GitHub MCP server's `search_pull_requests`
and `pull_request_read` (method `get_review_comments`, which reports `is_resolved` per thread) —
see AGENTS.md's rule about answering review threads for the reply and resolve calls.

**Answer a comment on the layer that owns the code, never the layer you are standing on.** The
rule is the one that governs a red check in a stack, for the same reason: a stack merges bottom-up,
so a fix committed above the layer being commented on arrives *after* that layer has already merged
without it. Fix at the owning layer, then rebase each layer above onto the one below (on a
workstation, `gh stack sync --prune` does that in one).

Each thread ends in a state: fixed and replied to with the commit, declined with the reason, or
filed as a `needs-triage` issue whose number is in the thread. Commit whatever you are holding at
the top of the stack before you go down (never `git stash` — AGENTS.md's *Parallel work*).

## Landing it

Merging is the human's, here as everywhere. It goes bottom-up; merging a middle layer merges
everything below it in one atomic operation, GitHub cascade-rebases what is left and the layers
above retarget themselves — that server-side cascade is precisely what registering bought, and it
is why nothing has to bring the rest forward by hand. A layer that goes red after a cascading
rebase is ordinary red CI and belongs to whoever owns the stack — AGENTS.md's rule that a failing
test is part of the work applies per layer.

## Claiming

One claim covers the whole stack, not one per layer. Post the `## Claim` comment on the issue with
the **bottom** branch as `Branch:` and name the layers you intend to open — see
[docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s "Claiming an issue". Three
half-claimed branches with no stated order is exactly the state that convention exists to prevent.
