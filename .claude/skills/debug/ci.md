# Debug: a red CI run

Part of the **debug** skill ([SKILL.md](SKILL.md)). Read it when a CI job is red, before root-causing anything locally.

## A red CI run: classify before root-causing

A 2026-08-07 sweep of 150 CI runs (34 failures) found that most red runs were not app or spec
bugs at all. Before diving into a spec, read the failed *job name* and the first error line, and
bucket the run — each bucket has a different owner and several need no work:

- **GitHub Actions platform outage** — "Failed to resolve action download info … Service
  Unavailable" or jobs dying before checkout, usually several branches at once in one time
  window (6 of the 34 were one afternoon's outage). Nothing to fix; re-run.
- **`reg-suit visual regression` red with "A branch or tag with the name '…' could not be
  found" + `Cannot find module …visual-pr-comment.mjs`** — the merged-branch checkout race
  (7 of the 34): the job checked out the PR head *branch by name* minutes after an auto-merge
  deleted it. Fixed 2026-08-07 by checking out the head SHA, which GitHub keeps reachable via
  `refs/pull/N/head` forever. (The fix also recreated the branch name locally, because the key
  generator of the day refused a detached HEAD; that half went away on 2026-08-23 when the keys
  became explicit.) If this signature reappears, look at that job's checkout step, not at any
  test.
- **A visual capture or Playwright shard red with `wedged, not slow` in its log** — the known
  unattributed Chromium renderer wedge; see the e2e-and-visual skill's renderer-wedge section. CI
  reruns only the failed tests once when that verdict is present; a run that is still red either
  wedged twice (rare — re-run and note it) or failed for a second, real reason in the same log.
- **`reg-suit visual regression` red with "No visual baseline published"** — a consequence,
  not a cause: some visual shard failed, so main published no snapshot. Fix the shard's
  failure; a green re-run publishes the baseline.
- **A real spec failure** — only now is it yours to root-cause with the loop in [SKILL.md](SKILL.md). Check
  first (Parallel work rule) that no open PR already owns the same spec.

Two spec flakes from that sweep are already fixed on main — trip-admission's alert-locator
strict-mode flake (#414) and `findTripOnBoard`'s board-paging barrier (a5c1dc9) — and one is
**known and open**: `signOut()` (e2e/helpers.ts) occasionally lands on
`/sign-in?callbackUrl=…` instead of `/` (run 31109626357, once in ~150 runs). Unverified
hypothesis: the sign-out server action's `redirect("/")` races the now-unauthenticated shop
page's own RSC refresh, whose redirect to `/sign-in` wins the router. If you catch it, that is
the thread to pull — it would be an app-level race a real user can hit, not a test bug.

## A failure only CI can reproduce

The OG-image socket failure took seven probe commits in 90 minutes because each probe asked one
question. When a failure has no local reproduction, spend the first commit making the failure
*legible* rather than guessing at fixes:

1. **Cut the run down to the failing test** (temporarily edit the CI matrix/spec filter) so each
   probe answers in minutes, not a full-suite cycle.
2. **Let the server speak**: capture the app server's stderr into the job log (this is how the
   libvips failure finally named itself). An assertion message describes the symptom; the process
   that failed knows the cause.
3. **Ask about the environment in batches, not one flag at a time** — fonts, `VIPSHOME`, missing
   binaries, what a library reports it can decode. One probe commit that prints all of them beats
   four that each print one.
4. **Mark probe commits `TEMPORARY:` and remove them before merge** — the branch history may keep
   them; `main` must not.
5. Remember what CI is that local isn't: Linux glyph rasterization (see `visual-triage`), a
   four-core runner running two workers × (browser + `next start`) — deliberate oversubscription,
   per `ci.yml` — a UTC clock, and fresh servers per shard (so a locally-reproducible tail failure
   is the *reused*-server trap in [flakes.md](flakes.md), not CI's problem).
