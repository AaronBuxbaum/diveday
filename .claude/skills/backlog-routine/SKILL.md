---
name: backlog-routine
description: Work the ready-for-agent issue backlog continuously, building each ticket as the next layer of one running GitHub stack. Use when asked to run the backlog, implement ready tickets, or keep building unattended.
---

# Work the backlog on one stack

One ticket at a time, each built on the branch of the one before it — related or not.

## The loop

1. **Pick.** `gh issue list --label ready-for-agent --state open`, skipping anything already
   labelled `in-progress`. Read `pnpm gates`' "Claimed — in flight" section first: a claim it
   reports **stale** is a dead session, not a reservation, so that work is free to take.
2. **Refuse the ones that are not yours.** If the body carries a *Blocked by* section naming a
   human decision — what a waiver version number asserts, which unit a package sells in — do not
   build it. Relabel `ready-for-human`, say why in a comment, pick another. Three of the queue's
   issues were in that state and each said so in its own words.
3. **Claim.** Add `in-progress`, post the `## Claim` comment
   ([issue-tracker.md](../../../docs/agents/issue-tracker.md)). **One claim covers the whole
   stack**, not one per layer.
4. **Check the premise before building it.** Roughly half of these tickets describe something that
   is no longer true, or true for a different reason. Reproduce it first — render the page, read the
   *compiled* CSS, run the query, count the call sites. Recent examples: "turning the contrast rule
   on would paint CI red" (it found 23 nodes and one mechanism), "any nav tap discards the form"
   (Activity keeps three routes; the real loss is invisible eviction), "eight surfaces disagree with
   their nav label" (four already agreed, through a duplicate message key). When the premise does
   not survive, say so in the PR **and** the issue, and build what the evidence supports.
5. **Cut the branch, commit once, open the draft PR and extend the stack** (below), then build it.
6. **Verify.** `pnpm check` green, e2e for any flow you touched, and *look at* every surface you
   changed in both schemes. Read each visual diff against the actual image before writing a word
   about it — `pnpm visual:report --commit <sha>` writes the PNGs.
7. **Finish the PR you already opened** at step 5 — body, position line, diff explanation — and
   `gh pr ready` it. Back to 1.

## One stack, not one branch per ticket

Cut each ticket's branch from the **previous ticket's branch**, not from `main`, even when the work
is unrelated:

```sh
# first layer of a fresh stack
git checkout -b claude/<slug-1> origin/main
# every layer after it
git checkout -b claude/<slug-2> claude/<slug-1>

# at the layer's FIRST commit, not when the ticket is finished:
# pushes, opens the missing pull request as a draft, chains the base, registers the stack
gh stack link claude/<slug-1> claude/<slug-2>
gh stack link <stack-number> claude/<slug-3>          # every layer after that

# no extension (a cloud session): the same two steps by hand — note -F, never -f
gh pr create --base claude/<slug-1> --draft --title … --body …
gh api --method POST repos/{owner}/{repo}/stacks \
  -F 'pull_requests[]=<bottom>' -F 'pull_requests[]=<next>'
gh api --method POST repos/{owner}/{repo}/stacks/{n}/add -F 'pull_requests[]=<new>'
```

**Open the pull request when you cut the branch.** A draft with one commit and a placeholder body is
the point; the body catches up at step 7. Every failure this routine has hit with stacks lived in the
gap between cutting a branch and opening its pull request.

**Why, concretely.** Thirteen branches cut from one `main` in a single session all edited
`AGENTS.md`'s `check:repo` row, a `docs/design/*.md` section, and a `scripts/*-baseline.json`. Every
one conflicted with every other, and resolving them afterwards by hand is the same merge done
thirteen times with none of the context that produced it. On a stack each layer already contains the
layers below, so those files merge **once, while the change is being written**.

It also removes the ratchet problem: a baseline written on layer 4 already counts layer 3's work, so
`--absorb` is for genuine merges from outside the stack rather than for your own previous ticket.

Every PR body names its position, because a reviewer arriving from a notification has no other way
to find the bottom:

> Layer 4 of 6 — based on `claude/<slug-3>` (#883). Above: `claude/<slug-5>` (#886).
> Review and merge bottom-up.

Read [stacked-prs](../stacked-prs/SKILL.md) before the first one. Two things from it that bite here:

- **Rebase a layer before reading its visual report.** A stale parent makes other people's merged
  work show up as your diff — 39 of 60 surfaces on one measured PR.
- **A cascading rebase moves a layer's baseline to a commit no CI run has published under**, so
  `reg` can report your surfaces as *new* rather than *changed*. Read the sticky
  `diveday:visual-summary` comment on **every** layer: if nothing resolved, that layer's counts mean
  nothing.

### When a stack is the wrong shape

**Not because the base can vanish.** This section used to say to measure the merge cadence first,
because twice in one session a base branch merged and was deleted while its next layer's PR body was
still being written, and `gh pr create --base` then failed with "No commits between … Base ref must
be a branch". Measured on 2026-08-23 (ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md)):
that is an artifact of opening the pull request at the *end* of a layer's work. A layer registered at
its first commit is retargeted by GitHub the moment its base merges, and even a branch orphaned that
way attaches with one `gh stack link`. Register early and fast merges cost nothing.

**What still argues against a stack is CI.** Every layer pays lint, typecheck, four unit shards, a
build and eight Playwright/visual shards, and pays again above every cascading rebase. So **start a
new stack** when the current one merges, or at about six layers — past that the wall-clock cost
outweighs the conflicts it saves.

**A fix that is not the ticket goes on its own branch off `main`**, not into the stack — an
unordered crew query found while triaging a diff, a race in a spec you did not touch. It should be
able to merge without waiting for six layers beneath it.

## What ends a turn

Done, filed, or handed over — never an intention (AGENTS.md's rule about queues that live in a
message).

- **You cannot merge.** `gh pr merge` is blocked by the permission classifier. Name the PRs that are
  ready and stop; do not work around it.
- **Anything you notice and do not do** becomes a `needs-triage` issue written for a reader with
  none of your context — not a line in the closing message.
- **A failing or flaky test is part of the work**, even when it is not yours and even when it is
  green on the rerun. Root-cause it; never widen a timeout to make it pass.
