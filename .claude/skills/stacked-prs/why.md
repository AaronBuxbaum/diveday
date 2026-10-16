# Stacked PRs: why everything stacks, and the exceptions

Part of the **stacked-prs** skill ([SKILL.md](SKILL.md)). Read it when deciding whether a branch may go off `main`, when a stack feels too long, or when a merge up stops on a generated file.

## Stack everything, and run one PR's CI at a time

**Stack everything, across threads, and run one PR's CI at a time: cut every branch from the
newest open one, any thread's, related or not, as a draft with `base` on it; the thread that owns
the stack pushes one layer at a time, because overlapping runs queue on a 20-job cap** (AGENTS.md's
*Parallel work*). Related or unrelated, a schema migration or a padding change, one file or forty —
the shape is the same, and it is the default rather than a special case for dependent chains (ADR
[20260821-stacked-pull-requests](../../../docs/architecture/decisions/20260821-stacked-pull-requests.md),
"Widened: stack by default"). Two different arguments arrive at that one habit.

**A dependent chain has no other honest shape.** Step 2 cannot compile, test, or be read without
step 1:

- `src/db/schema/` + migration → the `src/db` reader → the surface that renders it
- a `src/lib` domain rule → the feature module that composes it → the route
- a refactor that must land before the behaviour change that needs it

Anything else prices it as one unreviewable pull request or a session idling until its own earlier
one merges.

**Unrelated work stacks for a different reason: the conflicts.** A second branch cut from `main`
re-edits the same shared files as the first — `AGENTS.md`'s `check:repo` row, a `docs/design/*.md`
section, a section of `scripts/ratchets.json`, a message bundle — and each one is a merge resolved later, by
hand, without the context that produced it. Thirteen branches cut from one `main` in a single
session is the measured case, and every one of them conflicted with every other. On a stack each
layer already contains the layers below, so those files merge **once, while the change is being
written**. The ratchets are the sharpest version: a baseline written on layer 4 already counts layer
3's work, so `--absorb` is left for genuine merges from outside the stack rather than for your own
previous branch.

**Merging a layer up never stops on a generated file.** `.gitattributes` gives
`scripts/ratchets.json`, `scripts/test-durations.json`, the export-bundle snapshot and the glossary
and ADR indexes merge drivers (`scripts/merge-drivers.mjs`, installed by the `SessionStart` hook; a
human runs `node scripts/merge-drivers.mjs install` once; `pnpm agent:doctor` warns when they are
missing). The merge prints a line naming each file it settled
mechanically; then run **`pnpm regen`**, which rewrites all of them from their sources, and commit
what it changed before you push (`--no-snapshot` skips the slow one when no seed, schema or export file moved).

**A layer that moves pixels is a layer like any other.** That restriction was lifted on 2026-08-23
(Aaron's call, issue #905) once the trade was measured: losing the baseline race costs a **re-read,
not a missed regression**, and the pipeline now names each layer's baseline key and waits for the
layer below to publish it (issue #909). What replaces the restriction is the reading discipline
under *What our pipeline does with it* in [pipeline.md](pipeline.md) — never a reason to cut from `main` instead.

### What still goes on its own branch off `main`

1. **No stack is open.** `git fetch origin main` first, every time: if the branch below has merged,
   the next one cuts from the refreshed `origin/main` and there is no stack at all.
2. **A fix that must merge now** — a red `main`, a hotfix, a race in a spec you did not touch found
   while triaging someone else's diff. It should be able to merge without waiting for the layers
   beneath it.

Another thread's stack is not on that list either: stack on it, and leave the push order to the
thread that owns it. Its claims stay its own; yours name your layer.

**Depth is not on that list.** A stack has no maximum length — fifteen layers is as legitimate as
three, and a long chain is the shape this repository wants. Every layer already contains the ones
below it, so the shared files a session keeps re-editing (`AGENTS.md`'s `check:repo` row, a
baseline, a message bundle) merge once, while the change is being written, instead of once per
branch later and by hand. That saving *grows* with depth: the thirteen branches cut from one `main`
conflicted with each other thirteen ways, and the same thirteen stacked conflict zero. The reason
to cut from `main` never grows the same way.

CI does not bound depth, but it does set the pace. **Every layer runs the whole gate**, wherever it sits in the stack
(ADR [20261003-every-stack-layer-runs-ci](../../../docs/architecture/decisions/20261003-every-stack-layer-runs-ci.md)), so a green check on any layer
means that layer was tested. The middle-layer skip and cancel of
[20260919-stack-ci-cancels-superseded-layers](../../../docs/architecture/decisions/20260919-stack-ci-cancels-superseded-layers.md) are gone. The only hard ceiling is GitHub's own — a registered stack holds at most 100 pull
requests, and `scripts/stack-register.mjs` refuses a longer chain rather than truncating it
(`MAX_LAYERS`).
