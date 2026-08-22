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
# ... work, commit ...
git push -u origin claude/<slug>-1-schema

# layer 2, cut from layer 1 — not from main
git checkout -b claude/<slug>-2-reader claude/<slug>-1-schema
# ... work, commit ...
git push -u origin claude/<slug>-2-reader
```

Open each pull request with `base` set to the branch below (`create_pull_request` takes `base`;
`gh pr create --base <branch>`), and open the bottom one first so the chain reads in order. Every
body states its position and what is beneath it, because a reviewer who lands on layer 3 from a
notification has no other way to find the bottom:

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
# register existing chained-base PRs, bottom to top
gh api --method POST repos/{owner}/{repo}/stacks -f 'pull_requests[]=641' \
  -f 'pull_requests[]=642' -f 'pull_requests[]=643'

gh api repos/{owner}/{repo}/stacks                    # list stacks and their layers
gh api --method POST repos/{owner}/{repo}/stacks/{n}/add     # extend
gh api --method POST repos/{owner}/{repo}/stacks/{n}/unstack # dissolve
```

`pull_requests` is ordered bottom to top and takes 2–100 entries. GraphQL is read-only (`stack`,
`stackEntry` on `PullRequest`) — and in a cloud session the proxy serves only a pinned set of
GraphQL operations, so reach for the REST forms above rather than GraphQL. Programmatic merges must
use the asynchronous merge endpoint. A `404` means the preview is not enabled for the repository.

The `github/gh-stack` extension wraps the same REST endpoints (`gh stack link`, `view`, `sync`,
`merge`) and is convenient on a workstation. Do **not** rely on it in a cloud session: installing an
extension pulls a release asset from another repository, and the GitHub proxy scopes release-asset
requests to repositories attached to the session, so the install is expected to 403.

## What our pipeline does with it

- **CI runs in full on every layer.** `.github/workflows/ci.yml` triggers on a bare `pull_request:`
  with no branch filter, so a base of `claude/<slug>-1-schema` changes nothing.
- **`pnpm test:changed` and the destructive-migration guard** anchor on
  `git merge-base origin/main HEAD`, which in a stack is the fork point of the whole stack. Upper
  layers re-run lower layers' affected tests and re-check their migrations. Slower, never wrong —
  do not "fix" it by re-anchoring to the layer below.
- **Visual regression is the one unproven part.** `reg-keygen-git-hash-plugin` should resolve
  layer 2's baseline to layer 1's head commit, whose S3 snapshot exists only if layer 1's four
  visual shards went green in a run that finished first; a cascading rebase orphans keys published
  under the commits it rewrites. Read the sticky `diveday:visual-summary` comment on **every** layer
  before triaging pixels: if it says no baseline resolved, nothing was compared, and the diff counts
  on that layer mean nothing (see the **visual-triage** skill). Until this is measured, keep stacks
  to chains that do not move a rendered surface.

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
