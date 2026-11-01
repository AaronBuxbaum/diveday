---
paths:
  - "e2e/**"
  - "playwright.config.ts"
  - "scripts/route-coverage.json"
---

# Rules for `e2e/`

The **e2e-and-visual** and **visual-triage** skills are the procedures; the **debug** skill covers a
red run. Each rule names what enforces it; the reasoning and the incidents are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-e2e-rules).

- **Focused runs only, locally**: `pnpm e2e <spec> --reporter=line`, or `pnpm e2e:run <spec>` after
  `pnpm e2e:build`; `scripts/guard-bash.mjs` refuses the bare form.
- **A test that writes shop-wide settings takes `privateShop`** (`e2e/fixtures.ts`), never a
  `finally` that puts the setting back; `/api/test/reset` restores the schedule, not the
  configuration (`RESET_KEEPS` in `src/db/delete-path-coverage.test.ts`; ADR
  20260815-per-test-private-shops).
- **No timing guesses**: `waitForTimeout`, `networkidle`, spec-level `retries:` and retry loops fail
  `pnpm check:e2e-hygiene` unless the line says `diveday:allow-e2e-hygiene <rule>: <why>`. The suite
  runs `retries: 0`; CI allows one `--last-failed` rerun only when the structured per-test proof in
  `scripts/e2e-retry-policy.mjs` classifies every failure as a wedge; mixed or unknown failures stay
  red (#2633). On main only, a visual shard reruns any failed capture once and files one that passed
  only on the rerun as a `needs-triage` issue (H-20261022-visual-rerun-on-main).
- **Never navigate straight off a submit**: wait on the action's `?notice=` redirect or on what the
  row shows; reading the field back is not a wait (`check:e2e-hygiene`, `action-race`).
- **A click lands after React owns the page**: every `goto`/`reload`/`waitForURL` on a fixture page
  waits for the staff Search trigger's and section navs' `data-hydrated` (`settleStaffHydration`, `e2e/fixtures.ts`);
  a click after a `waitUntil: "commit"` opt-out fails `check:e2e-hygiene`, `pre-hydration-click`.
- **An absence assertion pairs with a positive query** of the same string elsewhere in the spec.
  A convention, not a guard (#1403).
- **A failing or flaky test is part of the work**, even when unrelated; search open PRs for a fix
  in flight first. A proven flake is fixed or quarantined, never skipped: tag it `@quarantine` with
  `// diveday:quarantine #<open issue> until <YYYY-MM-DD>: <what flakes>` on its line or the four
  above, at most 7 days out, at most 3 at once (`check:e2e-hygiene`). It then runs only in
  `e2e-nightly.yml` (`DIVEDAY_RUN_QUARANTINE=1`); the day after expiry every branch goes red.
- **Find by role and message key, never a sentence**: a new `getByText`/`toContainText` literal of
  40+ characters fails `check:e2e-hygiene` (a ratchet; the old ones are banked and only fall).
  ```ts
  import { diverTranslator } from "../src/i18n/messages";
  import { staffTranslator } from "../src/i18n/staff-messages";
  const diver = diverTranslator("en-US");
  const staff = staffTranslator("en-US");
  await page.getByRole("button", { name: "Leave my review" }).click();
  await expect(page.getByText(diver("reviews.savedPending"))).toBeVisible();
  await expect(page.getByText(staff("reviews.notice.publishedManyOther", { count }))).toBeVisible();
  ```
  Seed data is not copy: import its constant or quote fewer words.
- **A test's budget is one call with its measured reason**: `test.slow()` or `test.setTimeout()`,
  never both (the later one replaces the first). Each CI shard's summary lists the tests over half
  their own budget, and annotates those over 80% on their line (`scripts/e2e-budget-report.mjs`,
  #1906).
- **An HTTP contract takes the `request` fixture**, not a page: a redirect read with
  `maxRedirects: 0`, a feed, a probe (`e2e/seo.spec.ts`).
- **A geometry fix is proven by a capture**, not a class assertion; a rule read from source is a
  `check:repo` guard or a `guards` test, never a unit test beside the component
  ([testing.md](../../docs/engineering/testing.md#what-each-layer-is-for)).
- **Bound the page, not the capture**: a huge screenshot means the page needs a pager, never a
  `?filter=` in the spec.
- **A trouble state is photographed through `src/app/api/test/seed-trouble-states/route.ts`**,
  never seeded into the demo shop.
- **Every route has a spec and a capture**, derived from the path literals in `e2e/`, or a hand
  entry in `scripts/route-coverage.json` (click-reached coverage, or a written `exempt` reason):
  `pnpm check:route-coverage`.
- **Fixtures**: `staffContext.newPage()` and the exported fixtures (`pnpm check:e2e-fixtures`).
- **The clock is frozen at the harness** (`TEST_FROZEN_CLOCK`); never mask moving text.
- **Visual baselines live in S3 by commit**, rendered on CI's Linux runners (ADR
  20260729-reg-suit-visual-regression); approving a change is saying in the PR why the pixels moved.
- **The critical journeys keep their test**: the table in
  [testing.md](../../docs/engineering/testing.md#critical-journeys), held by
  `pnpm check:critical-journeys`; renaming a journey's test renames its row. Everything else takes
  what testing.md's six-step list gives it.
