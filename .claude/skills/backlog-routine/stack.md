# Backlog routine: one stack, not one branch per ticket

Part of the **backlog-routine** skill ([SKILL.md](SKILL.md)). Read it at step 7, before cutting a ticket's branch; when a stack is the wrong shape; and when a lower layer goes red.

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
git push -u origin claude/<slug-2>
# then open its pull request as a draft, with `base` set to claude/<slug-1>
```

**Open the pull request when you cut the branch.** A draft with one commit and a placeholder body is
the point; the body catches up at step 7. Every failure this routine has hit with stacks lived in the
gap between cutting a branch and opening its pull request.

**There is no registration step and nothing to wait for.** `.github/workflows/stack.yml` sees the
pull request event and registers the chain as a stack on a runner — a session cannot reach that
endpoint at all, which is what quietly stopped this working for nine days (ADR
[20260907-a-runner-registers-the-stack](../../../docs/architecture/decisions/20260907-a-runner-registers-the-stack.md)).
Anything telling you to run `gh stack link` or `gh api --method POST .../stacks` yourself is written
for a workstation.

**Why, concretely.** Thirteen branches cut from one `main` in a single session all edited
`AGENTS.md`'s `check:repo` row, a `docs/design/*.md` section, and a section of `scripts/ratchets.json`. Every
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

None of this is particular to the backlog any more: **stack everything, across threads, and run one
PR's CI at a time** is the repository-wide shape (AGENTS.md's *Parallel work*, the `stacked-prs`
skill; stacking since 2026-08-23, the CI half since 2026-10-12). This routine states it in
its own terms because it is where the habit is most load-bearing, not because it is the only place
it applies.

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
that is an artifact of opening the pull request at the *end* of a layer's work. A layer whose pull
request exists at its first commit is retargeted by GitHub the moment its base merges. Open early
and fast merges cost nothing.

**The fetch decides the shape.** After `git fetch origin main`, look at where the previous ticket's
branch is: merged, and the next ticket cuts from the refreshed `origin/main` with no stack at all —
which is the common case when the human is merging as fast as this routine builds. Still open, and
the next ticket stacks on it, because anything else means resolving the same conflict twice.

**Nothing argues against depth.** A stack has no length limit, and a routine that runs for hours
should expect a long one: ticket twelve stacks on ticket eleven exactly the way ticket two stacked
on ticket one. Every layer runs the whole CI gate (ADR 20261003-every-stack-layer-runs-ci; the
**stacked-prs** skill), so a deep stack costs runners, and that is the accepted price of every
layer's green meaning it was tested. Push one layer, let its run finish, then the next: overlapping
runs queue on the account's 20-concurrent-job cap. The stack restarts when the one below it **merges**, not at a layer count.

**A fix that is not the ticket goes on its own branch off `main`**, not into the stack — an
unordered crew query found while triaging a diff, a race in a spec you did not touch. It should be
able to merge without waiting for the layers beneath it.

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
3. **Then fix it there**, on that branch, and cascade — GitHub does it server-side for a
   registered stack; by hand it is:

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
