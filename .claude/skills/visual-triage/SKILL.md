---
name: visual-triage
description: Triage a red visual-regression failure in CI or locally — for each changed screenshot, decide whether it's an expected consequence of this branch's code changes or an unexplained regression, and either commit the updated baseline (expected) or leave it failing with an explanation (regression/unclear). Use whenever `e2e/visual.spec.ts` fails in CI or locally, whenever asked to review/approve/triage visual diffs, and proactively after pushing any PR with UI changes. AGENTS.md requires intentional visual changes to be called out for the reviewer, and this is how that call-out happens.
---

# Visual triage

Visual baselines live as PNGs committed to the repo under
`e2e/visual.spec.ts-snapshots/` (docs ADR 20260727-self-managed-visual-regression). There is no
hosted build or API: a pixel mismatch just fails the `toHaveScreenshot()` assertion in
`e2e/visual.spec.ts`, in CI or locally, the same way any other assertion failure would. This skill
is the first pass on that failure: read the code diff that produced it, decide which pixel changes
follow from it, and leave a paper trail for the ones that don't — so a human reviewing the PR is
confirming your reasoning, not starting from a failing CI check with no context.

## When this skill runs

**Any time `e2e/visual.spec.ts` fails** — a red `e2e` check in CI on a PR with UI changes, or a
local `pnpm e2e` / `pnpm e2e -- visual.spec.ts` run that comes back with screenshot mismatches.
Run it proactively after pushing a PR with UI changes, the same way the old Argos check used to be
watched for — the difference is you don't need to wait for a separate upload; the failure shows up
on the same e2e job that already runs on every push.

**Because baselines are ordinary git files, you don't need to fetch anything from CI to triage a
failure someone else's push produced.** Check out the pushed commit locally and re-run the visual
suite — Playwright regenerates the exact same `expected`/`actual`/`diff` comparison locally that
CI just produced, because the baseline it's diffing against is the same file in the same repo.
There's no separate service, account, or build ID to look up.

## The three outcomes

Every failing screenshot lands in exactly one bucket:

1. **Expected** — the code diff plausibly produces this exact pixel change. Regenerate the
   baseline and commit it. A one-line note in the commit message is enough ("global focus-ring
   token" style) — the commit diff itself (old PNG vs. new PNG, viewable via GitHub's image-diff
   viewer) is the record.
2. **Unexplained regression** — nothing in the code diff touches this surface, and the image shows
   something that reads as broken (misaligned, wrong color, missing content) rather than
   ambiguous. Leave the baseline untouched (test stays red) and say in the PR: what you checked,
   what you expected, what's actually different.
3. **Genuinely unclear** — you can't tell. Maybe it's an indirect effect of a shared component
   nobody obviously touched, maybe the diff image doesn't show enough to be sure. Leave the
   baseline untouched and write down *why* it's unclear and what would resolve it. **This is the
   case the skill exists for** — regenerating everything that looks plausible and staying silent
   on the rest would be worse than not triaging at all, because it teaches the reviewer to stop
   reading your commits closely.

Silence is only earned by (1), and even then the baseline-update commit's own message is the
paper trail — see step 5 below on why it can't be silent in a different way (folded into the code
commit).

## Step by step

### 1. Reproduce the failure locally

```
git fetch origin <branch> && git checkout <branch>
pnpm e2e:build
pnpm exec playwright test e2e/visual.spec.ts --reporter=line
```

Failing assertions print the test name and, on failure, Playwright writes `expected.png`,
`actual.png`, and `diff.png` into `test-results/<sanitized-test-title>/` (and bundles the same
trio into `playwright-report/`, which CI also uploads as an artifact on failure — useful if you'd
rather read that instead of re-running locally, e.g. no local checkout handy). Note every failing
screenshot name before moving on — that's your triage list.

### 2. Pull the code diff you're going to reason against

```
git diff origin/main..HEAD --stat
git diff origin/main..HEAD
```

Keep this in view for the rest of the triage — every decision in step 4 is "does this diff explain
that pixel change," so read it once up front rather than re-deriving it per screenshot.

### 3. Group by root cause

Screenshots that differ only by scheme (`-light`/`-dark`) or viewport (`-vw-390`/`-vw-1280`) on
the same surface usually share one root cause — typically the same component or design-token
change. A shared-token change can turn one real decision into 8 near-identical diffs; decide once
per group and say "N screenshots, same root cause" rather than re-litigating each viewport
separately.

### 4. Look before deciding

For each group, open `expected.png`, `actual.png`, and `diff.png` with `Read` — don't guess from
the test name alone. `diff.png` highlights what moved; pull the other two when the highlight
doesn't make the *what* obvious (e.g. a subtle color shift the highlight color visually competes
with).

Map the screenshot name back to a route: it's `<capture-name>-<scheme>-vw-<width>.png` (or
`<capture-name>-print.png` for the print block), and `e2e/visual.spec.ts` (read the whole
`capture()` call sequence, not just the one call) shows exactly which page each `<capture-name>`
navigates to. From the route, the route map in AGENTS.md (or a quick grep for the page path) gets
you to the source files that could produce this pixel change — the page/component, a shared
primitive under `src/components/` or `src/app/`, a design token in `src/app/globals.css`, or seed
data in `src/db/seed.ts`.

### 5. Decide

- File from step 4 appears in the diff from step 2, and the pixel change is consistent with what
  that file's change would do → **expected**. Regenerate:
  ```
  pnpm exec playwright test e2e/visual.spec.ts --update-snapshots
  ```
  (scope with `-g "<test name>"` to avoid touching unrelated baselines if only some groups are
  expected). Stage only the regenerated PNGs and commit them **as their own commit, separate from
  the code change** — e.g. `Update visual baselines: focus-ring token change`. This is the whole
  point: a human reviewing the PR sees the baseline update as its own labeled diff (GitHub renders
  PNG changes with a 2-up/swipe/onion-skin image viewer), not something silently folded into the
  commit that caused it. Never run `--update-snapshots` and bundle the result into the same commit
  as the feature/fix — that's exactly the "agent silently approves its own regression" failure mode
  this whole workflow exists to prevent.
- Nothing in the diff touches anything that could plausibly reach this surface, and the image
  itself reads as broken → **unexplained regression**. Leave the baseline as-is, comment on the PR
  (or in chat if there's no PR yet) with what you checked and what looks wrong.
- Anything short of that confidence in either direction → **unclear**. Leave the baseline as-is,
  comment explaining why it's ambiguous and what would resolve it.

One more bucket worth naming even though it isn't a verdict: a diff that's only a handful of
antialiased edge pixels (the kind the webfont-swap flake used to produce — see the comment at the
top of `visual.spec.ts`) *and* nothing in the code diff plausibly touching that surface reads as
flaky rather than a regression or an intentional change. Say so in the comment; don't regenerate
the baseline to paper over it — find and fix the actual source of nondeterminism (the suite runs
with `retries: 0` on purpose, see the `e2e-and-visual` skill).

### 6. Push and confirm green

Push the baseline-update commit (if any). CI's `detect-changes` job (`.github/workflows/ci.yml`)
notices a push that only touches `e2e/visual.spec.ts-snapshots/` and narrows the `e2e` job to just
`e2e/visual.spec.ts`, so this round trip is quick. If anything was left in the regression/unclear
bucket, the `e2e` job stays red — correctly, until a human resolves it.

### 7. Report back in chat

Summarize the same breakdown in your reply — counts per bucket, and the specific screenshots left
red for the human — so they know what to go verify rather than having to discover it themselves.

## Pitfalls

- Don't regenerate a baseline because a change *could* be explained by something in the diff —
  regenerate because you checked and the surface actually connects to that file. "Well, something
  changed and something in the diff touches CSS" is the unclear bucket, not the expected one.
- Never combine a baseline-update commit with the code change that caused it, even when you're
  fully confident it's expected. Keeping them separate is what makes the review meaningful — a
  human (or a later session) can always see exactly which pixels changed and read the one-line
  reason, without having to guess it out of a much larger diff.
- If `pnpm exec playwright test e2e/visual.spec.ts` comes back green, there's nothing to triage —
  say that and stop rather than reviewing screenshots nobody asked about.
