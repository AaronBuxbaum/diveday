# Stacked PRs: registration and what CI does with a stack

Part of the **stacked-prs** skill ([SKILL.md](SKILL.md)). Read it when a stack does not show as registered, a `gh pr merge` or `gh pr edit --base` is refused, or a layer's CI, migration guard or visual report looks wrong.

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
  landed. If a chain of yours has not become a stack, that log says why. A **fork** is the one
  refusal that also speaks: the registrar posts a single comment on the refused layer naming both
  tips, so the owning thread's PR-activity subscription wakes it (#2587).
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

- **Every layer runs the whole CI gate.** `.github/workflows/ci.yml` triggers on a bare
  `pull_request:` with no branch filter and no stack condition, so a base of
  `claude/<slug>-1-schema` gets the identical gate `main` does (ADR [20261003-every-stack-layer-runs-ci](../../../docs/architecture/decisions/20261003-every-stack-layer-runs-ci.md)).
  Read every layer's checks: each one's green means it ran. Two things follow:

  1. **A layer's visual diff is its own when it can be.** When the layer below's commit (the
     `merge-base` of the PR's base sha and HEAD) has a published snapshot, the layer compares
     against it and the sticky comment says so; otherwise it falls back to the stack's fork point
     from `main`, and the diff is **cumulative** (ADR [20261012-visual-baseline-layer-below](../../../docs/architecture/decisions/20261012-visual-baseline-layer-below.md)).
  2. **One PR's CI at a time, bottom first, driven by the thread that owns the stack.** Push a
     layer, let its run finish, then push the next. Runs on different branches do not cancel each
     other (a push cancels only its own branch's previous run, and each main push has its own
     group); they queue. On 2026-10-12, 15 to 19 layers pushed together cost 126 cancelled runs
     and 90 failed jobs as each restack force-pushed every layer and each break rode up the stack.
     Never cancel a main push run: `guard-bash.mjs` refuses it. Each layer is a ~25-job run against the account's 20-concurrent-job
     cap, so even two overlapping runs queue (runs 4558 to 4563 on 2026-10-10 took 23 to 28 min
     each against 14 to 17 alone). The per-prompt context line counts the account's open pull
     requests, so a second run in flight is visible before you push.
- **The destructive-migration guard** anchors on
  `git merge-base origin/main HEAD`, which in a stack is the fork point of the whole stack. Upper
  layers re-check lower layers' migrations. Slower, never wrong — do not "fix" it by re-anchoring
  to the layer below. `pnpm verify:push` is the one that diffs against the layer below
  (the PR's base; before the PR exists, `git config branch.<branch>.divedayBase origin/<parent>`
  or the nearest contained layer), because its tests and specs would otherwise be the whole
  stack's.
- **Visual regression handles a stack on its own, and a stack may move pixels.** The baseline key is
  *named* rather than inferred: `regconfig.json` uses `reg-simple-keygen-plugin` and
  `scripts/reg-suit-keys.mjs` resolves **every** layer's baseline to
  `git merge-base origin/main HEAD` — the stack's fork point, whatever branch the layer targets.
  `main` published that snapshot long before your run started, so no layer waits on another (ADR [20260919-stack-ci-cancels-superseded-layers](../../../docs/architecture/decisions/20260919-stack-ci-cancels-superseded-layers.md), superseding the
  20-minute poll from
  [20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md)).

  `scripts/wait-for-baseline.mjs` then narrows a stacked layer to the layer below when that commit
  already published, never waiting for it. On the fallback path, read a report this way: **the top layer's diff is the whole stack's**, because
  every layer beneath it is also above the fork point. That is usually what you want from the top —
  it is the closest thing a stack has to a statement about the merged result — but do not read it as
  "this layer moved 40 surfaces". Compare it against the bottom layer's report, which is its own
  delta and nothing else.

  Two obligations stand, because they are about reading rather than about any race:

  1. **Read the sticky `diveday:visual-summary` comment on the layer you are triaging.** If it says
     nothing was compared, nothing was compared: that layer's counts mean **unknown**, never "no
     visual changes" (see the **visual-triage** skill). It now means the fork point itself published
     no snapshot — a `main` run that was cancelled or lost a shard — and the comment names the
     ancestor it fell back to.
  2. **Never merge a layer whose pixels were never compared** on the grounds that the count was
     zero. Zero-changed with zero baselines is the failure, not the pass.
- **Rebase a layer before you read its visual report.** A branch whose parent has fallen behind
  `main` compares against that *parent*, while CI captures the pull request *merged with `main`* —
  so every commit merged in between shows up as your diff. That is not a stack-specific bug, but a
  stack is where a stale parent is most likely: PR #668 reported 60 changed surfaces of which 39
  belonged to other people's merged work, and rebasing cut it to 21.
