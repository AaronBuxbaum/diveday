---
name: visual-triage
description: Triage visual-regression diffs in CI or locally — for each changed screenshot, decide whether it's an expected consequence of this branch's code changes or an unexplained regression. Use whenever CI generates a `ci: capture visual baseline diffs` commit, `e2e/visual.spec.ts` fails, CI cannot push baselines, or the user asks to review/approve/triage visual diffs. AGENTS.md requires intentional visual changes to be called out for the reviewer, and this is how that call-out happens.
---

# Visual triage

Visual baselines live as PNGs committed to the repo under
`e2e/visual.spec.ts-snapshots/` (docs ADR 20260727-self-managed-visual-regression). There is no
hosted build or API. In CI, the serialized visual job runs Playwright once with
`--update-snapshots`; a pixel mismatch becomes a generated baseline commit on same-repo branches
instead of a red screenshot assertion. This skill is the first pass on that diff or on any red
visual job: read the code diff that produced it, decide which pixel changes follow from it, and
leave a paper trail for the ones that don't — so a human reviewing the PR is confirming your
reasoning, not starting from a screenshot dump with no context.

## When this skill runs

**Any time CI produces visual evidence** — a generated `ci: capture visual baseline diffs` commit,
a red `e2e/visual.spec.ts` job, or a forked PR artifact because CI could not push baselines back to
the branch. Run it proactively after pushing a PR with UI changes, the same way the old Argos check
used to be watched for — the difference is you don't need a separate hosted service.

**Because baselines are ordinary git files, you don't need to fetch anything from CI to triage a
diff someone else's push produced.** Check out the branch locally and inspect the generated
baseline commit, or re-run the visual suite when the job stayed red. There's no separate service,
account, or build ID to look up.

## The three outcomes

Every changed screenshot lands in exactly one bucket:

1. **Expected** — the code diff plausibly produces this exact pixel change. If CI already created
   the `ci: capture visual baseline diffs` commit, review it and call it out in the PR; if you are
   working locally or CI could not push, regenerate the baseline and commit it separately.
2. **Unexplained regression** — nothing in the code diff touches this surface, and the image shows
   something that reads as broken (misaligned, wrong color, missing content) rather than ambiguous.
   Do not bless the generated baseline; revert or replace it, fix the underlying issue, and say in
   the PR what you checked, what you expected, and what's actually different.
3. **Genuinely unclear** — you can't tell. Maybe it's an indirect effect of a shared component
   nobody obviously touched, maybe the image diff doesn't show enough to be sure. Do not silently
   accept the baseline commit; write down *why* it's unclear and what would resolve it. **This is
   the case the skill exists for** — accepting everything that looks plausible and staying silent
   on the rest would be worse than not triaging at all.

Silence is only earned by (1), and even then the baseline-update commit's own message is the paper
trail — see step 5 below on why it can't be silent in a different way (folded into the code
commit).

## Step by step

### 1. Find the visual evidence

```
git fetch origin <branch> && git checkout <branch>
git log --oneline -- e2e/visual.spec.ts-snapshots/
```

If CI generated a `ci: capture visual baseline diffs` commit, that commit's PNG diff is your
triage list. If the job stayed red or you are investigating locally, reproduce it:

```
pnpm e2e:build
pnpm exec playwright test e2e/visual.spec.ts --reporter=line
```

Failing assertions print the test name and write `expected.png`, `actual.png`, and `diff.png` into
`test-results/<sanitized-test-title>/` (and into `playwright-report/`, which CI uploads on
failure). Note every failing screenshot name before moving on.

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

For each group, open the old and new PNGs from the generated baseline commit, or open
`expected.png`, `actual.png`, and `diff.png` from `test-results/` when the job failed — don't
guess from the test name alone. `diff.png` highlights what moved; pull the other two when the
highlight doesn't make the *what* obvious.

Map the screenshot name back to a route: it's `<capture-name>-<scheme>-vw-<width>.png` (or
`<capture-name>-print.png` for the print block), and `e2e/visual.spec.ts` (read the whole
`capture()` call sequence, not just the one call) shows exactly which page each `<capture-name>`
navigates to. From the route, the route map in AGENTS.md (or a quick grep for the page path) gets
you to the source files that could produce this pixel change — the page/component, a shared
primitive under `src/components/` or `src/app/`, a design token in `src/app/globals.css`, or seed
data in `src/db/seed.ts`.

### 5. Decide

- File from step 4 appears in the diff from step 2, and the pixel change is consistent with what
  that file's change would do → **expected**. If CI already committed the new baselines, leave that
  separate commit in place and call it out in the PR. If you need to generate locally:
  ```
  pnpm exec playwright test e2e/visual.spec.ts --update-snapshots
  ```
  (scope with `-g "<test name>"` to avoid touching unrelated baselines if only some groups are
  expected). Stage only the regenerated PNGs and commit them **as their own commit, separate from
  the code change**. This is the whole point: a human reviewing the PR sees the baseline update as
  its own labeled diff (GitHub renders PNG changes with a 2-up/swipe/onion-skin image viewer), not
  something silently folded into the commit that caused it.
- Nothing in the diff touches anything that could plausibly reach this surface, and the image
  itself reads as broken → **unexplained regression**. Do not keep a generated baseline commit that
  blesses it; revert the PNG change or fix the bug, then comment on the PR with what you checked
  and what looks wrong.
- Anything short of that confidence in either direction → **unclear**. Do not silently keep a
  generated baseline commit; comment explaining why it's ambiguous and what would resolve it.

One more bucket worth naming even though it isn't a verdict: a diff that's only a handful of
antialiased edge pixels (the kind the webfont-swap flake used to produce — see the comment at the
top of `visual.spec.ts`) *and* nothing in the code diff plausibly touching that surface reads as
flaky rather than a regression or an intentional change. Say so in the comment; don't keep or
regenerate the baseline to paper over it — find and fix the actual source of nondeterminism.

### 6. Push and confirm green

Push any manual baseline or revert/fix commit. CI's `detect-changes` job
(`.github/workflows/ci.yml`) notices a change that only touches
`e2e/visual.spec.ts-snapshots/` and skips the non-visual Playwright matrix, so this round trip is
quick. If anything was left in the regression/unclear bucket, the PR should stay blocked until a
human resolves it.

### 7. Report back in chat

Summarize the same breakdown in your reply — counts per bucket, whether CI generated the baseline
commit, and the specific screenshots left for the human — so they know what to verify rather than
having to discover it themselves.

## Pitfalls

- Don't regenerate a baseline because a change *could* be explained by something in the diff —
  regenerate because you checked and the surface actually connects to that file. "Well, something
  changed and something in the diff touches CSS" is the unclear bucket, not the expected one.
- Never combine a baseline-update commit with the code change that caused it, even when you're
  fully confident it's expected. Keeping them separate is what makes the review meaningful — a
  human (or a later session) can always see exactly which pixels changed.
- If CI produced no baseline commit and `pnpm exec playwright test e2e/visual.spec.ts` comes back
  green, there's nothing to triage — say that and stop rather than reviewing screenshots nobody
  asked about.
