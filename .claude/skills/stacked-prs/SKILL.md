---
name: stacked-prs
description: Split a dependent chain of work into stacked pull requests — chained base branches, GitHub stacks, cascading rebase, bottom-up merge. Use when one scope has steps that cannot compile or review independently (schema → db reader → surface), or when asked to review, rebase, or land an existing stack.
---

# Stacked pull requests

A stack is an ordered chain of pull requests in this repository: the bottom targets `main`, each one
above targets the head branch of the one below. GitHub runs the cascading rebase server-side, merges
bottom-up and atomically, and retargets what is left onto `main`
(ADR [20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md)).

## When this is the right shape

Use a stack only for a **dependent** chain — step 2 cannot compile, test, or be read without step 1:

- `src/db/schema.ts` + migration → the `src/db` reader → the surface that renders it
- a `src/lib` domain rule → the feature module that composes it → the route
- a refactor that must land before the behaviour change that needs it

Do **not** stack independent slices. Two features that merely arrived in the same session are two
pull requests, and AGENTS.md's *Parallel work* rules already cover them. The cost is real: every
layer pays lint, typecheck, four unit shards, a build and eight Playwright/visual shards, and pays
again after every cascading rebase.

## Building the chain

A session does both halves itself: it builds the **shape** — the chained branches and pull requests —
and then registers that shape as a stack. The shape is the whole substance; registering adds the
cascading rebase and the group merge on top of it.

```sh
# layer 1, cut from main
git checkout -b claude/<slug>-1-schema main
# ... first commit ...

# layer 2, cut from layer 1 — not from main
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

- **CI runs in full on every layer.** `.github/workflows/ci.yml` triggers on a bare `pull_request:`
  with no branch filter, so a base of `claude/<slug>-1-schema` changes nothing.
- **`pnpm test:changed` and the destructive-migration guard** anchor on
  `git merge-base origin/main HEAD`, which in a stack is the fork point of the whole stack. Upper
  layers re-run lower layers' affected tests and re-check their migrations. Slower, never wrong —
  do not "fix" it by re-anchoring to the layer below.
- **Visual regression: a stack may move pixels, and the price is that a layer's counts are not
  always readable yet.** `reg-keygen-git-hash-plugin` resolves layer 2's baseline to **layer 1's head
  commit** — confirmed by running its `CommitExplorer` over a throwaway two-layer stack, which needs
  no CI at all because it reads only the local git graph. That half is what makes a stack's diffs
  readable: each layer shows its own pixels rather than everything below it. The other half is a
  race. A cascading rebase rewrites layer 1, so layer 2's key moves to a commit **no CI run has
  published under**; layer 1's own rebase will publish it, so whether layer 2 finds a baseline
  depends on layer 1's four visual shards finishing first.

  This skill used to answer that by keeping stacks off rendered surfaces. **Aaron lifted that on
  2026-08-23: stack everything, pixels included** (ADR
  [20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md),
  "Reversed: a stack may move pixels"). Backlog work is mostly rendered surfaces, so the restriction
  was disqualifying the ordinary case, and losing the race costs a **re-read**, never a missed
  regression — the surfaces report as *new*, and `diveday:visual-summary` prints that count in its
  own column.

  What that makes mandatory, per layer, before you write a word about pixels:

  1. **Read the sticky `diveday:visual-summary` comment on the layer you are triaging.** If it says
     nothing was compared, nothing was compared: that layer's counts mean **unknown**, never "no
     visual changes" (see the **visual-triage** skill).
  2. **Do not triage it in that state.** Wait for the layer below's `visual` and `visual-report`
     jobs to finish, then re-run this layer's (`gh run rerun`, or the run's own control) and read
     the refreshed comment. The baseline exists after that; it did not before.
  3. **Never merge a layer whose pixels were never compared** on the grounds that the count was
     zero. Zero-changed with zero baselines is the failure, not the pass.

  The lever, if this ever costs more than it saves: reg-suit's key generator is a plugin slot, and
  `reg-simple-keygen-plugin` takes `expectedKey`/`actualKey` outright. It is not enough on its own —
  an explicit key cannot conjure a snapshot layer 1 has not published yet — so the fix is that
  plugin *plus* gating layer 2's visual job on layer 1's (issue #909).
- **Rebase a layer before you read its visual report.** A branch whose parent has fallen behind
  `main` compares against that *parent*, while CI captures the pull request *merged with `main`* —
  so every commit merged in between shows up as your diff. That is not a stack-specific bug, but a
  stack is where a stale parent is most likely: PR #668 reported 60 changed surfaces of which 39
  belonged to other people's merged work, and rebasing cut it to 21.

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
