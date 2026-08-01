---
name: e2e-and-visual
description: Write and maintain Playwright functional E2E tests and Playwright visual-regression captures that stay stable and complete. Use when adding or changing a user-facing flow or surface, when a visual diff appears, or when deciding what needs an E2E spec or visual scenario.
---

# E2E flows and visual regression

Every important user flow gets a functional Playwright spec under `e2e/`. Every important user surface gets a visual screenshot in `e2e/visual.spec.ts` using `page.screenshot()`. Diffs and reference comparisons are handled by `reg-suit` against baselines stored in S3. Keep the two concerns separate: functional specs prove behavior; visual specs capture rendered surfaces.

## Visual workflow

1. Add or update the screenshot capture in `e2e/visual.spec.ts`.
2. Reuse existing setup fixtures such as `signedInAsOwner()`, `/api/test/reset`, and page interactions exactly as a user would.
3. Run the visual suite locally to generate screenshots and compare:
   ```bash
   pnpm visual
   ```
4. If there are diffs, `reg-suit` will compare against the reference commit images on S3. Run `pnpm visual:report` to pull the reference, actual, and diff PNGs down locally with a markdown summary — the printed HTML report link is a client-rendered SPA (an empty `<div id="app">` until JS runs) and isn't fetchable as a static page, so agents should use the script instead of trying to open that link. See the **visual-triage** skill.

The normal matrix is light/dark × phone/desktop (390x844 and 1280x800) using the `capture()` helper. Print surfaces use the `capturePrint()` helper.

## Determinism

The tests run a production Next server backed by in-memory PGlite. The browser context fixture in `e2e/fixtures.ts` resets `/api/test/reset` and freezes the browser clock to the same `DIVEDAY_CLOCK` used by the server, aborts Google Maps, and handles color schemes. Before every screenshot, `capture()` runs `paintWholeDocument()` (scrolls the page through so Chromium rasterizes every band — a `fullPage` shot of a tall page can otherwise come back with unpainted bands below the fold) and waits for `document.fonts.ready`. That does not by itself wait for a route's content: `page.goto` resolves on the streamed shell, so a route with a `loading.tsx` can still get photographed mid-skeleton. **Every capture site must wait for something the real content renders** — a heading, a known element, or for a Client Component, a control it only renders once mounted — before calling `capture()`; a capture that navigates and shoots immediately is a bug even if it happens to pass once.

Do not mask clock-derived content or moving UI. Freeze the clock at the harness boundary instead. If a capture is unstable, identify and remove the source of nondeterminism: use the seeded Blue Mantis data, stable labels, deterministic ordering, and explicit readiness waits. Use `DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z` for the committed baseline instant.

## Functional E2E rules

- Import `test` and `expect` from `e2e/fixtures`, not directly from `@playwright/test`, so tests get per-worker server routing and reset isolation.
- Exercise real Next, Auth.js, and PGlite boundaries. Disable third-party HTTP in the server and abort browser-only Google Maps requests.
- Reuse the per-worker owner session with `signedInAsOwner()` for staff flows; keep auth lifecycle coverage on the live sign-in form.
- Keep safety-critical failure paths (capacity, waiver/medical state, cert/nitrox gating, and manifest/roll call) explicit.

## Locator visibility: prefer getByRole/getByLabel over getByText

`getByRole`, `getByLabel`, and `getByPlaceholder` query the accessibility tree, which already
excludes anything a hidden `display:none` ancestor removes from accessibility — a collapsed
`<details>`, a tab panel, and (should this app re-enable `cacheComponents`; see
ADR 20260801-cache-components-e2e-activity-migration, currently Proposed) a React
`<Activity mode="hidden">` boundary from client-side navigation. `getByText` and a raw `.locator()`
used as a final matcher do **not** filter by visibility — they match hidden elements too, so a
strict-mode call can throw "resolved to N elements" the moment two matching elements exist
anywhere in the DOM, visible or not, not just when both are actually on screen.

Default to `getByRole`/`getByLabel` for anything with an accessible role or label; reach for
`getByText` only when there's no role/label to query (plain prose, a status message). If a spec's
`getByText` genuinely needs to be visibility-safe, chain `.filter({ visible: true })` — the
pattern `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`'s Testing section
itself recommends. Read that file directly before relying on more than this paragraph — it's a
provider doc, not something to treat as this repo's own contract.

## Capture full-size; bound the page in code

Captures are `fullPage` and unfiltered. If a surface screenshots enormous, that is a finding about
the *page*, not a problem with the screenshot: fix it with pagination or a sensible default range
in the product, where a real shop gets the benefit too. Do not add a filter to the spec to shrink
the picture — it hides the unbounded page and quietly narrows what the baseline can catch.

The orders index is the worked example: 323 seeded orders, no pager, ~17,700px and 2.5MB per
scheme per viewport, and no baseline at all. The answer was `ORDER_PAGE_SIZE`, not `?personQuery=`.

## A capture only covers the state it captures

A surface having a baseline is not the same as your change having one. Check that the captured
*state* actually renders the thing you changed, and treat "no diff appeared" as a question rather
than an answer.

The shop-currency change (ADR 20260731-shop-currency) rewrote how the diver payments row formats an
amount. `diver-profile` was already captured, the suite went green, and it proved nothing: none of
the three captured divers has a single order, so that section had only ever been photographed empty.
The orders list and order detail — the densest money screens in the product — had no capture at all.
Three surfaces' worth of blind spot, behind a passing check.

So when a change lands on a surface that renders rows, money, badges, or any other state-dependent
content:

- Confirm against the seed which fixture the capture actually lands on, rather than assuming a
  populated page. `pnpm test` with a throwaway probe against `seededShopContext({ history: true })`
  settles it in a minute — note that `history` defaults to **false** in tests and **true** in the
  e2e/dev seed, so a test-db probe with the default finds an empty world.
- Prefer adding a capture in the populated state to repointing an existing one; the existing
  capture is usually the baseline for some *other* state, and moving it trades one blind spot for
  another.
- If a change you expected to move pixels moves none, find out why before shipping. Say so in the
  PR if it stays unexplained — a silent pass is not evidence.

## Definition of done

- New/changed behavior has a Playwright flow spec or an explicit reason not to add one.
- New/changed important surfaces have screenshot captures in `e2e/visual.spec.ts` and both schemes where applicable.
- Each capture lands on a state that actually exercises the change (see above), not merely on the right route.
- `pnpm visual` runs successfully, and any visual differences are expected and reviewed via `pnpm visual:report` (or the reg-suit HTML report, for a human).
- `pnpm check` passes; run `pnpm e2e` when functional flows changed.
