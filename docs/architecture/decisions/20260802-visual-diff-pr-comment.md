# 20260802-visual-diff-pr-comment — Warn loudly on visual diffs; never block on them

- **Status:** Accepted
- **Date:** 2026-08-02
- **Relates to:** [20260729-reg-suit-visual-regression](20260729-reg-suit-visual-regression.md),
  [20260802-shard-visual-regression-ci](20260802-shard-visual-regression-ci.md)

## Context

"A pushed PR is not done until visual diffs are accounted for" is the strongest-worded hard rule in
`AGENTS.md`, and it had the weakest signal in the pipeline. `e2e/visual.spec.ts` asserts nothing by
design, and `reg-suit run` exits 0 whether it found 234 differences or none
(`node_modules/reg-suit/lib/cli.js` exits non-zero only on a thrown error), so the `visual-report`
job is green either way. That non-blocking posture is deliberate — 20260729 chose it, and this
record keeps it. What was missing was not enforcement but **visibility**: a diff was discoverable
only by a human opening the S3-hosted `index.html`, which is a client-rendered SPA that no agent and
no notification can read.

The `reg-notify-github-plugin` is configured and live — it posts a `reg-suit[bot]` comment through
reg-suit's GitHub App. Its commit-status side effect was disabled on 2026-08-24 after the only
repository collaborator encountered a self-approval dead end on a stacked PR. The comment remains
useful and stays. Its payload is counts and a link, and nothing else: the plugin POSTs
`{failedItemsCount, newItemsCount, deletedItemsCount, passedItemsCount, reportUrl}`
(`node_modules/reg-notify-github-plugin/lib/github-notifier-plugin.js`). Two consequences follow
from that shape, and they are the whole reason for this decision.

**It cannot name a surface.** A reader learns that thirteen images changed but not which ones, so
the cheapest possible triage — "the diff is confined to the surfaces my diff touched" — still costs
a browser session.

**It cannot tell a comparison from a non-comparison.** 20260729 documents a failure mode where
baseline resolution silently fails — detached-HEAD checkout, shallow clone, a push whose parent
snapshot was never published — and *every* screenshot is reported as `new` instead of diffed. The
changed count is then a reassuring **zero** while nothing was compared against anything. Any summary
that leads with "0 changed" faithfully reproduces that lie at a new layer.

And when `reg-suit run` throws outright, the plugin never runs at all: the loudest failure produces
the quietest PR.

## Decision

Add a step to the `visual-report` job that reads the `out.json` reg-suit just published and restates
it as **one sticky PR comment**, found by an HTML marker and edited in place on each push. It warns;
it never blocks.

- **Never fails the build.** `scripts/visual-pr-comment.mjs` exits 0 on every path, and the step
  carries `continue-on-error: true` on top of that. Unexplained diffs stay a review obligation, not
  a red check. `if: ${{ !cancelled() }}` so it still reports when the compare step stumbled — that
  is precisely when a reviewer needs to know no pixel was checked.
- **Reports all three change categories with equal prominence.** The headline is
  `N changed, N new, N deleted`, never just the failed count.
- **Names the "nothing was compared" condition in plain words.** `expectedItems` is the number of
  baseline images reg-suit actually downloaded; when it is zero the comment's headline is
  `NOTHING WAS COMPARED`, the prose disowns the zero in its own table, and it points at 20260729.
  A run that genuinely compared surfaces and found no differences says so in different words —
  "no differences across N compared surface(s)… a baseline did resolve". The two are never
  confusable, which is the entire point of the summary.
- **Bounded lists, stated bounds.** Ten item names per category, then an explicit
  "…and **N** more not listed here". AGENTS.md forbids a silent cap.
- **Degrades instead of erroring.** No secrets (every fork PR, by design), no PR number (a push to
  main), a read-only token, an S3 miss — each produces an explanatory summary rather than a failure,
  and the job summary always receives the same markdown even when there is no PR to comment on.
- **Zero dependencies, invoked with bare `node`.** The step must be able to report when
  `pnpm install` or `reg-suit run` is the thing that broke.
- **Job-scoped `permissions: {contents: read, pull-requests: write}`.** This is the only job in the
  workflow that writes back to GitHub. `contents: read` is spelled out because naming any permission
  drops every unnamed scope to `none` for that job, and the checkout needs it.

The parsing, classification, and wording live in `scripts/visual-report-lib.mjs`, shared with
`pnpm visual:report` (`scripts/visual-report.mjs`) so the local agent-facing report and the CI
comment can never diverge in what they call a clean run. `REPORT.md` gained the same verdict
headline for the same reason.

## Alternatives considered

- **Fail the job on unexplained diffs.** Rejected by the owner, consistent with 20260729. Visual
  diffs are frequently legitimate — a rebaseline is a merge, not a regeneration — and a red check
  that is routinely correct-to-ignore trains people to ignore it. A check nobody trusts is worse
  than a comment everybody reads.
- **A label-based escape hatch** (`visual-approved` to turn the check green). Considered and
  declined: it converts "explain the pixels" into "apply the label", which is the same theatre with
  extra steps.
- **A GitHub Check Run with a `neutral` conclusion.** Would render the intent literally, but needs
  `checks: write` on top of the comment permission and adds an API surface that can fail. The
  comment plus a never-failing step expresses the same thing with less machinery.
- **Replace reg-suit's own comment** (`prComment: false` in `regconfig.json`). Rejected: removing
  the App's counts comment to avoid a second comment would trade real signal for tidiness. Two
  comments is the accepted cost; ours is sticky, so the thread does not grow.
- **Turn off reg-suit's `reg` commit status** so visual regression remains visible without making a
  stack unmergeable when no separate reviewer is available. Adopted on 2026-08-24: the repository
  sets `reg-notify-github-plugin.setCommitStatus` to `false` in `regconfig.json`. The reg-suit
  comment, hosted report, and repository-owned visual summary remain unchanged; only the external
  red commit status is removed.
- **Upload `out.json` as a GitHub artifact** and read it from there. The S3 key is already the
  contract `scripts/visual-report.mjs` depends on; a second publication path is a second thing to
  keep in sync.

## Consequences

- A PR now carries two visual-regression comments: reg-suit's counts comment and this summary. The
  summary's footer says which is which, and it is edited in place rather than appended.
- The comment is only as truthful as `out.json`. If reg-suit ever stops publishing `expectedItems`,
  `summarizeReport` falls back to reconstructing the baseline set from passed + failed + deleted —
  covered by a test — but any future field rename needs the same treatment.
- `vitest.config.ts` now includes `scripts/**/*.test.mjs`, so repo scripts carrying real logic are
  covered by `pnpm check` like the app is. `scripts/visual-report-lib.test.mjs` is the first.
- CI behavior cannot be exercised locally. The parsing and wording are unit-tested against realistic
  `out.json` fixtures — including the zero-failed/all-new baseline failure and the missing-report
  case — and the script was run end to end against a real published report, but the comment
  posting, the token scope, and the `!cancelled()` path are first exercised on the PR that lands
  this.
