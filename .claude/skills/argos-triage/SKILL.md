---
name: argos-triage
description: Triage an Argos visual-regression build — for each changed screenshot, decide whether it's an expected consequence of this branch's code changes or an unexplained regression, and record that decision in Argos (approve, flag, or leave pending) so a human never has to start from a blank slate of 20+ unreviewed diffs. Use whenever asked to review/triage/check/approve an Argos build or visual diffs, and proactively after an e2e run reports Argos changes on a branch with UI changes, before calling that work done — AGENTS.md requires intentional visual changes to be called out for the reviewer, and this is how that call-out happens without waiting on a human to open Argos first.
---

# Argos triage

Argos (`aaron-buxbaum/diveday` — re-derive via `getMe`/`listProjects` if that ever looks wrong,
e.g. after an account move) diffs every e2e run's 48 screenshots against the base branch and marks
the build `changes-detected` until a human approves it in the Argos UI. Left alone, that human
opens a build with a couple dozen thumbnails and no context for which ones they meant to change.
This skill does the first pass: read the code diff that produced the build, decide which visual
diffs follow from it, and leave a paper trail for the ones that don't — so review in Argos is
confirming your reasoning, not starting from a blank slate. **`createReview` is already
pre-approved in this repo's `.claude/settings.json`** — acting on this skill's own findings without
re-asking each time is the point.

## The three outcomes

Every changed screenshot lands in exactly one bucket:

1. **Expected** — the code diff plausibly produces this exact pixel change. Approve it. A
   one-line note is enough ("global focus-ring token" style); it doesn't need a paragraph, because
   the approval itself is the record and the reviewer can always drill into the diff image.
2. **Unexplained regression** — nothing in the code diff touches this surface, and the image shows
   something that reads as broken (misaligned, wrong color, missing content) rather than
   ambiguous. Flag it (`REQUEST_CHANGES`) with a comment: what you checked, what you expected,
   what's actually different.
3. **Genuinely unclear** — you can't tell. Maybe it could be an indirect effect of a shared
   component nobody obviously touched, maybe the diff image doesn't show enough to be sure. Leave
   it undecided and write down *why* it's unclear and what would resolve it. **This is the case the
   skill exists for** — approving everything that looks plausible and staying silent on the rest
   would be worse than not triaging at all, because it teaches the human to stop reading your
   approvals closely.

Silence is only earned by (1). Both (2) and (3) get a comment — if you're not approving it, say
why, because "flagged, no explanation" gives the reviewer nothing they didn't already have.

## Step by step

### 1. Find the build

```
git branch --show-current
```

`listBuilds` with `owner: aaron-buxbaum`, `project: diveday`, `head: <branch>` — take the newest
result. If its `head.sha` doesn't match local `HEAD`, say so in your summary rather than silently
reviewing a stale build (someone may have pushed since). If there's no build for the branch yet
(CI still running, or the branch hasn't been pushed), say that plainly and stop — don't guess at a
different build. If the user named a build number or PR directly, use that instead of searching.

### 2. Pull the code diff you're going to reason against

```
git diff <build.base.sha>..<build.head.sha> --stat
git diff <build.base.sha>..<build.head.sha>
```

(`git fetch origin <sha>` first if either commit isn't local.) Keep this diff in view for the rest
of the triage — every decision in step 5 is "does this diff explain that pixel change," so read it
once up front rather than re-deriving it per screenshot.

### 3. List the diffs that need a decision

`listBuildDiffs` with `needsReview: true`, paginating with `perPage: 100` if `pageInfo.total`
exceeds one page.

**Group by the `group` field before doing anything else.** Diffs that share a `group` hash share a
root cause — typically the same surface's light/dark or phone/desktop variant, but also unrelated
surfaces that share a component or a design token. A shared-token change can turn one real decision
into 8 near-identical diffs; deciding each independently is both slower and risks a reviewer seeing
inconsistent verdicts on what's actually one change. Decide once per group, apply the verdict to
every snapshot `id` in it, and say "N snapshots, same root cause" in the shared comment.

### 4. Look before deciding

For each group, download images to the scratchpad and view them with Read — don't guess from the
test name alone:

- The diff's own top-level `url` is the overlay Argos renders in its UI (highlights what moved) —
  start there.
- Pull `base.url` and `head.url` too when the overlay doesn't make the *what* obvious (e.g. a
  subtle color shift the overlay's diff-highlight color visually competes with).

Map the screenshot back to a route: `name` is `<capture-name>-<scheme> vw-<width>.png`, and
`e2e/visual.spec.ts` (short — read the whole `capture()` sequence, not just the one call) shows
exactly which page each `<capture-name>` navigates to. From the route, the route map in AGENTS.md
(or a quick grep for the page path) gets you to the source files that could produce this pixel
change — the page/component, a shared primitive under `src/components/` or `src/app/`, a design
token in `src/app/globals.css`, or seed data in `src/db/seed.ts`.

### 5. Decide

- File from step 4 appears in the diff from step 2, and the pixel change is consistent with what
  that file's change would do → **expected**, approve.
- Nothing in the diff touches anything that could plausibly reach this surface, and the image
  itself reads as broken → **unexplained regression**, flag + comment.
- Anything short of that confidence in either direction → **unclear**, leave pending + comment.

One more bucket worth naming even though it isn't a verdict: a diff with a very small `score`
(near the ~0.0003–0.0005 range that's typically anti-aliasing/font-swap noise — see the comment at
the top of `visual.spec.ts` about the webfont-swap flake this repo already hit once) *and* nothing
in the code diff plausibly touching that surface reads as flaky rather than as a regression to flag
or an intentional change to approve. Say so in the comment and point at the `change.id` for
`ignoreChange` — but don't call `ignoreChange` yourself. It's a standing suppression that silences
this diff on every future build, which is a bigger and less reversible call than approving one
build's snapshot, and the clock here is frozen specifically so this shouldn't happen — a human
should look once before it's silenced permanently.

### 6. Submit

One `createReview` call for the build, with a `snapshots` entry (`APPROVE` or `REQUEST_CHANGES`)
for every screenshot you reached a verdict on — omit the ones left pending, that's what leaves them
undecided in Argos. Set the top-level `event` to `"APPROVE"` only if every screenshot in the build
got approved with nothing flagged or left pending; otherwise use `"COMMENT"`, because asserting
build-level approval while part of it is still undecided would be the exact silence this skill
exists to avoid. Attach the per-group explanations as comments (`createComment`, anchored to a
`screenshotDiffId` via `anchor`/`screenshotDiffId` when it's about one specific diff, unanchored
for a note that covers a whole group) — `addToReview: true` bundles them into the same review.

### 7. Report back in chat

Summarize the same breakdown in your reply — counts per bucket, the build URL, and the specific
screenshots left for the human — so they know what to go verify in Argos rather than having to
discover it themselves. This is the point of the skill: their trip to Argos is confirming your
reasoning, not doing the first pass.

## Pitfalls

- Don't approve because a change *could* be explained by something in the diff — approve because
  you checked and the surface actually connects to that file. "Well, something changed and
  something in the diff touches CSS" is the unclear bucket, not the expected one.
- A `change.occurrences > 0` means this exact diff already showed up on a prior build and wasn't
  ignored — worth a mention in the comment, but it's evidence, not a verdict on its own; a
  recurring diff can still be a real, still-unfixed regression.
- If `listBuildDiffs` comes back empty under `needsReview: true`, the build has nothing left to
  triage (already reviewed, or `no-changes`/`accepted`) — say that and stop rather than reviewing
  diffs nobody asked about.
