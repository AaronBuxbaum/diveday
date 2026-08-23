---
name: backlog-routine
description: Work the ready-for-agent issue backlog continuously — ticket after ticket, never stopping at one, refetching main and re-reading CI between each. Use when asked to run the backlog, implement ready tickets, or keep building unattended.
---

# Work the backlog, ticket after ticket

One at a time, from a freshly fetched `main` each time — and stacked on the ticket before it when
that one has not merged yet.

## This does not stop after one ticket

The loop below is a loop. Finishing a ticket is step 9, and step 9 goes back to step 1 — with a
fresh `git fetch`, a look at what CI made of the pull requests already open, a re-read of the queue,
and the next ticket claimed. **A turn that builds one
ticket and then reports has not run this routine**, and the queue it was pointed at is not
measurably shorter: it grows by roughly one issue per session as agents file what they noticed.

It ends in exactly one of these states, and nothing else:

- the queue holds nothing an agent may take — every remaining issue is `ready-for-human`, blocked on
  a human decision, or claimed by a live session;
- something needs the human and cannot proceed without them (a merge, a credential, a call only
  they can make) — say which, and stop;
- the person running it says stop.

"I have opened N pull requests" is not one of them. Neither is "the next ticket would be #764":
either build it or say why you are not.

## The loop

1. **Start from the main everyone else has been merging into.** `git fetch origin main` before
   every ticket, not once at the top of the session. This routine's own pull requests merge while it
   is still running — five of seven did in one session, one of them inside the minute a stack was
   being registered — so a branch cut from the `origin/main` you fetched an hour ago starts life
   behind, conflicts with work that is already in, and reads its own merged changes as somebody
   else's diff. Fetching costs a second; not fetching costs a rebase.
2. **Read what GitHub says about the pull requests you already opened**, in the same breath:

   ```sh
   gh pr list --author '@me' --state open --json number,title,mergeable,statusCheckRollup
   gh pr checks <n>          # for any that reports a failure
   ```

   CI takes about ten minutes and you opened that pull request before you started the last ticket,
   so **its answer arrives while you are not looking.** A red check on your own branch is your work
   — the same rule as any failing test — and it does not become someone else's by being one ticket
   behind you. Two of one session's pull requests went red this way: a spec asserting the old 404
   wording, and a spec measuring a scroll position one frame early. Both were the change working;
   both would have shipped as somebody else's mystery if nothing had circled back.

   Fix it now, before the next ticket, and **on the branch that owns the defect** — which in a stack
   is often not the layer the failure was reported on. See *When a lower layer goes red* below. The
   exception is a `reg` failure, which is the visual report and belongs to the human — read every
   diff image, explain each one in the pull request, and carry on
   ([visual-triage](../visual-triage/SKILL.md)).
3. **Pick.** `gh issue list --label ready-for-agent --state open`, skipping anything already
   labelled `in-progress`. Read `pnpm gates`' "Claimed — in flight" section first: a claim it
   reports **stale** is a dead session, not a reservation, so that work is free to take.
4. **Refuse the ones that are not yours.** If the body carries a *Blocked by* section naming a
   human decision — what a waiver version number asserts, which unit a package sells in — do not
   build it. Relabel `ready-for-human`, say why in a comment, pick another. Three of the queue's
   issues were in that state and each said so in its own words.
5. **Claim.** Add `in-progress`, post the `## Claim` comment
   ([issue-tracker.md](../../../docs/agents/issue-tracker.md)). **One claim covers the whole
   stack**, not one per layer.
6. **Check the premise before building it.** Roughly half of these tickets describe something that
   is no longer true, or true for a different reason. Reproduce it first — render the page, read the
   *compiled* CSS, run the query, count the call sites. Recent examples: "turning the contrast rule
   on would paint CI red" (it found 23 nodes and one mechanism), "any nav tap discards the form"
   (Activity keeps three routes; the real loss is invisible eviction), "eight surfaces disagree with
   their nav label" (four already agreed, through a duplicate message key). When the premise does
   not survive, say so in the PR **and** the issue, and build what the evidence supports.
7. **Cut the branch, commit once, open the draft PR and extend the stack** (below), then build it.
8. **Verify.** `pnpm check` green, e2e for any flow you touched, and *look at* every surface you
   changed in both schemes. Read each visual diff against the actual image before writing a word
   about it — `pnpm visual:report --commit <sha>` writes the PNGs.
9. **Finish the PR you already opened** at step 7 — body, position line, diff explanation — and
   `gh pr ready` it. **Then go back to step 1** — fetch, re-read the queue, take the next one. Do
   not summarise, do not ask whether to continue, and do not wait for the pull request you just
   opened to merge: it is the human's to merge, and the next ticket does not depend on it.

## One stack, not one branch per ticket

Cut each ticket's branch from the **previous ticket's branch**, not from `main`, even when the work
is unrelated:

```sh
git fetch origin main                                  # every ticket, before anything else

# first layer of a fresh stack, or any ticket whose predecessor has already merged
git checkout -b claude/<slug-1> origin/main
# every layer after it, while the one below is still open
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

**A ticket that moves pixels is a layer like any other.** Stacking used to stop at rendered
surfaces; Aaron lifted that on 2026-08-23, because backlog tickets are mostly rendered surfaces and
the restriction was disqualifying the ordinary case. What it costs is a re-read, never a missed
regression — see [stacked-prs](../stacked-prs/SKILL.md) and ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md).

Read that skill before the first stack. Three things from it that bite here, and the third is the
new one:

- **Rebase a layer before reading its visual report.** A stale parent makes other people's merged
  work show up as your diff — 39 of 60 surfaces on one measured PR.
- **A cascading rebase moves a layer's baseline to a commit no CI run has published under**, and the
  pipeline now handles that itself: a stacked layer's `visual-report` waits up to 20 minutes for the
  layer below to publish before comparing (issue #909). Read the sticky `diveday:visual-summary`
  comment on **every** layer anyway — if nothing resolved, the wait gave up and that layer's counts
  mean nothing.
- **A layer in that state is not triaged, and not merged on a count of zero.** The layer below's
  `visual`/`visual-report` jobs are red or were still running twenty minutes on: fix those, re-run
  this layer's, and read the refreshed comment. Zero changed with zero baselines is the failure, not
  the pass.

### When a stack is the wrong shape

**Not because the base can vanish.** This section used to say to measure the merge cadence first,
because twice in one session a base branch merged and was deleted while its next layer's PR body was
still being written, and `gh pr create --base` then failed with "No commits between … Base ref must
be a branch". Measured on 2026-08-23 (ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md)):
that is an artifact of opening the pull request at the *end* of a layer's work. A layer registered at
its first commit is retargeted by GitHub the moment its base merges, and even a branch orphaned that
way attaches with one `gh stack link`. Register early and fast merges cost nothing.

**The fetch decides the shape.** After `git fetch origin main`, look at where the previous ticket's
branch is: merged, and the next ticket cuts from the refreshed `origin/main` with no stack at all —
which is the common case when the human is merging as fast as this routine builds. Still open, and
the next ticket stacks on it, because anything else means resolving the same conflict twice.

**What still argues against a stack is CI.** Every layer pays lint, typecheck, four unit shards, a
build and eight Playwright/visual shards, and pays again above every cascading rebase. So **start a
new stack** when the current one merges, or at about six layers — past that the wall-clock cost
outweighs the conflicts it saves.

**A fix that is not the ticket goes on its own branch off `main`**, not into the stack — an
unordered crew query found while triaging a diff, a race in a spec you did not touch. It should be
able to merge without waiting for six layers beneath it.

### When a lower layer goes red

Moving on while CI runs is the point — you should be building layer 3 while layer 2 is still being
checked. What that buys has to be paid for by **going back down when the answer arrives**. Step 2 of
the loop is where you find out; this is what to do about it.

**Fix it on the layer that owns the defect, never on the one you happen to be standing on.** A
Playwright failure reported on layer 3 usually belongs to layer 2 or 1, because every layer's CI runs
the layers beneath it. Patching it at the top makes the red layer merge broken and merge *first* — a
stack merges bottom-up, so a fix above the defect is a fix that arrives after it.

Three questions, in this order, and only the third is ever "write a fix":

1. **Is the layer stale rather than wrong?** `git fetch origin main`, then
   `git merge-base --is-ancestor <suspect-commit> origin/<branch>`. A stack cut before a fix landed
   on `main` carries the bug the whole way up, and the answer is a **rebase of the bottom, cascaded**
   — not a commit on the red layer. A worked case: a whole three-layer stack was cut minutes before
   the fix for `add-diver.spec.ts`'s scroll assertion merged, so layer 2 failed on a spec nobody in
   that stack had touched, and patching that spec would have conflicted with the fix already in
   `main`.
2. **Which layer introduced it?** `git log -S'<the failing thing>' --oneline origin/main..HEAD`, or
   read the failing assertion and ask which layer's change it describes. Check that layer's own pull
   request too: if it is red for the same reason, you have your answer.
3. **Then fix it there**, on that branch, and cascade — `gh stack sync --prune`, or by hand:

```sh
git checkout claude/<slug-1> && git rebase origin/main && git push --force-with-lease
git checkout claude/<slug-2> && git rebase claude/<slug-1> && git push --force-with-lease
git checkout claude/<slug-3> && git rebase claude/<slug-2> && git push --force-with-lease
```

**Commit whatever you are holding before you go down.** The top layer's work in progress belongs in
a WIP commit on its own branch — never `git stash`, which is one shared slot several sessions can
collide in (AGENTS.md's *Parallel work*).

**Then come back up and carry on.** The interruption ends when the lower layer is pushed and its
checks are running again; do not sit and watch them, and do not re-verify the layers above by hand.
Every layer re-runs CI from scratch above a rebase, which is what tells you.

**One thing a cascading rebase costs you: the visual baselines.** Each layer's key moves to a commit
no CI run has published under, so `reg` can report *every* surface as new rather than changed. Read
the sticky `diveday:visual-summary` comment on **every** layer afterwards — if nothing resolved,
that layer's counts mean nothing and there is no diff there to approve or explain
([stacked-prs](../stacked-prs/SKILL.md)).

**An unexpected visual diff is the same procedure.** Ask which layer painted those pixels before
writing a word about them: read the images, find the layer whose change explains them, and if none
does, that is a bug to fix at its own layer rather than a diff to approve
([visual-triage](../visual-triage/SKILL.md)).

## What ends a turn

Done, filed, or handed over — never an intention (AGENTS.md's rule about queues that live in a
message).

- **You cannot merge.** `gh pr merge` is blocked by the permission classifier. Name the PRs that are
  ready and stop; do not work around it.
- **Ask GitHub what is open at the moment you write it down, never your own memory of opening it.**
  These merge fast: one session's closing message listed seven pull requests as awaiting review and
  every one of them had already merged — the human went looking for them and found nothing. One
  `gh pr list --author '@me' --state open` immediately before writing the summary is the whole fix,
  and the same command tells you whether anything of yours is red.
- **Anything you notice and do not do** becomes a `needs-triage` issue written for a reader with
  none of your context — not a line in the closing message.
- **A failing or flaky test is part of the work**, even when it is not yours and even when it is
  green on the rerun. Root-cause it; never widen a timeout to make it pass.
