---
name: e2e-and-visual
description: Write stable Playwright E2E specs and visual-regression captures. Use when adding or changing a user-facing flow or surface, or deciding what needs a spec or a capture.
---

# E2E flows and visual regression

Which tests a change needs is [testing.md](../../../docs/engineering/testing.md#how-a-change-decides-its-tests)'s six-step list, and the browser floor is its [critical journeys](../../../docs/engineering/testing.md#critical-journeys) table (`pnpm check:critical-journeys` fails when a journey's test disappears; renaming that test renames its row). Functional specs live under `e2e/`; captures in `e2e/visual.spec.ts` use `page.screenshot()`, and [captures.md](captures.md) says which states earn one. Diffs and reference comparisons are handled by `reg-suit` against baselines stored in S3. Keep three concerns separate: functional specs prove behavior; request-level tests (the `request` fixture) prove an HTTP contract; visual specs capture rendered surfaces.

**A geometry fix is proven by a capture**: the overlap, clip or misalignment is gone in the PNG. A class-name assertion beside the component proves nothing a render shows; a rule over source is a `check:repo` guard.

## Visual workflow

1. Add or update the screenshot capture in `e2e/visual.spec.ts`.
2. Reuse existing setup fixtures such as `signedInAsOwner()`, `/api/test/reset`, and page interactions exactly as a user would.
3. Run the visual suite locally to generate screenshots and compare:
   ```bash
   pnpm visual
   ```
4. If there are diffs, `reg-suit` will compare against the reference commit images on S3. Run `pnpm visual:report` to pull the reference, actual, and diff PNGs down locally with a markdown summary — the printed HTML report link is a client-rendered SPA (an empty `<div id="app">` until JS runs) and isn't fetchable as a static page, so agents should use the script instead of trying to open that link. See the **visual-triage** skill.

The normal matrix, from the `capture()` helper: light at phone and desktop (390x844 and 1280x800), dark at desktop only (`DARK_VIEWPORTS`); a `TABLET_SURFACES` name adds 820x1180 in light. One `capture()` call is three images, four for a tablet surface. A dark-only bug at phone width is not photographed: check it by eye when a change is colour work that only shows narrow. Print surfaces use the `capturePrint()` helper.

## What a diff runs

- **Specs**: `pnpm e2e:affected` names the strong specs (edited, quoting removed text, on an edited
  route), the five smoke tests, and the reach specs ranked by how much of the diff they name;
  `verify:push` runs them. `--commit <sha>` replays one commit. It never names `visual.spec.ts`.
- **Captures**: a pull request photographs what `scripts/visual-affected.mjs` selects. The same
  selection, light only, locally:
  ```bash
  mkdir -p test-results
  pnpm exec playwright test e2e/visual.spec.ts --list --reporter=json > test-results/list.json
  node scripts/visual-affected.mjs --list test-results/list.json --out test-results/picked.json --grep test-results/grep.txt
  pnpm e2e:run e2e/visual.spec.ts --grep "$(cat test-results/grep.txt)" --reporter=line
  ```
  A surface you expected to move that reads as passed means the selection missed it: the
  `visual-all` label captures everything, and the miss is filed.

## Fast iteration

`pnpm e2e` always rebuilds first. While iterating on one spec, build once with `pnpm e2e:build`,
then rerun with `pnpm e2e:run <spec> --reporter=line` — it reuses the existing `.next` build and
skips straight to Playwright, finishing in seconds instead of minutes. It warns (but does not
fail) when source under `src/` looks newer than the build; rebuild if a failure looks confusing.

## Functional E2E rules

- Import `test` and `expect` from `e2e/fixtures`, not directly from `@playwright/test`, so tests get per-worker server routing and reset isolation.
- Exercise real Next, Auth.js, and PGlite boundaries. Disable third-party HTTP in the server, and answer browser-only Google Maps requests with an empty page: an aborted frame draws Chrome's broken-frame glyph, and every capture with a map baselined it.
- Reuse the per-worker owner session with `signedInAsOwner()` for staff flows; keep auth lifecycle coverage on the live sign-in form.
- Keep safety-critical failure paths (capacity, waiver/medical state, cert/nitrox gating, and manifest/roll call) explicit.
- Find elements by role and accessible name, or by the sentence's message key (`diverTranslator("en-US")`, `staffTranslator("en-US")`); a new `getByText`/`toContainText` literal of 40+ characters fails `check:e2e-hygiene` (`.claude/rules/e2e.md` has the example).
- A proven flake is fixed, or quarantined with `@quarantine` and `// diveday:quarantine #<issue> until <date>` (at most 7 days, 3 at once); it then runs nightly only (testing.md "Flakes").

## Reference

Read the file for the case in front of you:

- [determinism.md](determinism.md) — waits, clocks, animation, fonts, and the driver-bounded renderer wedge.
- [shops.md](shops.md) — which shop a writing spec uses, so parallel workers never collide.
- [locators.md](locators.md) — hidden or duplicated elements and what the page fixture does about them.
- [captures.md](captures.md) — which states of a surface need their own visual capture.

## Capture full-size; bound the page in code

Captures are `fullPage` and unfiltered. If a surface screenshots enormous, that is a finding about
the *page*, not a problem with the screenshot: fix it with pagination or a sensible default range
in the product, where a real shop gets the benefit too. Do not add a filter to the spec to shrink
the picture — it hides the unbounded page and quietly narrows what the baseline can catch.

The orders index is the worked example: 323 seeded orders, no pager, ~17,700px and 2.5MB per
scheme per viewport, and no baseline at all. The answer was `ORDER_PAGE_SIZE`, not `?personQuery=`.

## Definition of done

- Each new or changed behavior has the test testing.md's six-step list gives it; a changed critical journey still passes under its ledger title.
- A new screen or state has the capture [captures.md](captures.md) says it earns.
- Each capture lands on a state that actually exercises the change ([captures.md](captures.md)), not merely on the right route.
- `pnpm visual` runs successfully, and any visual differences are expected and reviewed via `pnpm visual:report` (or the reg-suit HTML report, for a human).
- The local gate passes (`pnpm check:repo`, `pnpm lint`, `pnpm typecheck`), then
  `pnpm verify:push`, which runs the specs `pnpm e2e:affected` names. The whole suite runs on CI.
