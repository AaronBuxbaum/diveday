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

The tests run a production Next server backed by in-memory PGlite. The browser context fixture in `e2e/fixtures.ts` resets `/api/test/reset` and freezes the browser clock to the same `DIVEDAY_CLOCK` used by the server, aborts Google Maps, and handles color schemes. Before every screenshot, `capture()` runs `paintWholeDocument()` (scrolls the page through so Chromium rasterizes every band — a `fullPage` shot of a tall page can otherwise come back with unpainted bands below the fold) and waits for `document.fonts.ready`. That does not by itself wait for a route's content: `page.goto` resolves on the streamed shell, so a route with a `loading.tsx` can still get photographed mid-skeleton — and since ADR 20260804-instant-navigation **every** route has one, so this is no longer a hazard on only a handful of surfaces. **Every capture site must wait for something the real content renders** — a heading, a known element, or for a Client Component, a control it only renders once mounted — before calling `capture()`; a capture that navigates and shoots immediately is a bug even if it happens to pass once. Watch for a wait that the *previous* page also satisfies: after a client-side click, an eyebrow or nav label shared by both pages resolves instantly against the old DOM and shoots the new route's skeleton (see the `order-detail` capture, which waits on "Back to diver" for exactly this reason).

Do not mask clock-derived content or moving UI. Freeze the clock at the harness boundary instead. If a capture is unstable, identify and remove the source of nondeterminism: use the seeded Blue Mantis data, stable labels, deterministic ordering, and explicit readiness waits. Use `DIVEDAY_CLOCK=2026-07-21T13:30:00.000Z` for the committed baseline instant.

## The renderer wedge: every renderer-dependent wait is driver-bounded

Chromium's renderer occasionally stops answering entirely on CI — not slow, *gone*: it won't
return even a trivial `page.evaluate(() => true)`. It is non-deterministic, unattributed after
multiple investigations (fa51f893, the 20260804 bound, run 31147282309), strikes arbitrary pages
(the landing page inside the first capture's first wait, `/pricing`, a diver record), and
vanishes on same-commit reruns. Treat it as browser infrastructure, not something to root-cause
in app or spec code — the probe verdict "wedged, not slow" in the log *is* the diagnosis.

The harness discipline that contains it, which any new capture code must keep:

- **No renderer-dependent call may rely on Playwright's own timeouts.** Page-side bounds
  (`setTimeout`, `requestAnimationFrame` races) cannot fire in a renderer that stopped running
  the page, and `page.evaluate` has no timeout of its own. Worse, `page.screenshot`'s `timeout:`
  option bounds only the preparation, not the protocol call — measured on run 31147282309, a
  screenshot with `timeout: 15_000` hung 95+ seconds until the test's own ceiling killed it. So
  every such call goes through a driver-side `Promise.race` bound: `withRendererBound` for
  evaluates, `screenshotOrGiveUp` for screenshots. A new screenshot call site in
  `e2e/visual.spec.ts` must use `screenshotOrGiveUp`, never bare `page.screenshot`.
- **On a stall, probe before blaming.** Both helpers ask the page `evaluate(() => true)` with a
  5s bound and word their message by the answer: alive means our wait leaked (investigate);
  "wedged, not slow" means the known wedge.
- **The literal phrase `wedged, not slow` is load-bearing.** ci.yml's visual job greps the
  capture log for it: a failed capture step carrying that verdict gets exactly one
  `--last-failed` rerun, because a proven-wedged browser is the one failure a rerun cannot mask.
  Any failure without the verdict stays red on the first attempt — this is not a retry policy,
  and `retries: 0` remains the suite's contract. Reword the phrase and the gate silently dies.
- **Why containment matters this much:** one wedged capture fails its shard, a failed shard
  uploads no screenshots, `visual-report` then compares nothing — and on main publishes no
  baseline, blinding visual regression repo-wide until a human re-runs the shard.

## Fast iteration

`pnpm e2e` always rebuilds first. While iterating on one spec, build once with `pnpm e2e:build`,
then rerun with `pnpm e2e:run <spec> --reporter=line` — it reuses the existing `.next` build and
skips straight to Playwright, finishing in seconds instead of minutes. It warns (but does not
fail) when source under `src/` looks newer than the build; rebuild if a failure looks confusing.

## Which shop a test writes to

Every spec in a run shares one seeded `blue-mantis` shop, and which specs land in a shard together
is decided by Playwright's sharding rather than by anyone's intent. `/api/test/reset` (the auto
`demoReset` fixture) makes that safe for most writes: it restores the shop's whole **schedule**
before every test — trips, bookings, waivers, roll call, the roster, the catalog, the dive sites,
the promo codes, the waiver template — so cancelling a departure, filling a boat, or blowing out a
charter leaves nothing for the next spec to trip over.

What it does not restore is the shop's **configuration**. The list is `RESET_KEEPS` in
`src/db/delete-path-coverage.test.ts`, and it is short and specific:

- `shop_backup_destinations`, `shop_backup_deliveries`, `shop_whatsapp_accounts`,
  `media_deletion_attempts`;
- every `shops` column but `review_url`, `depth_unit` and `temperature_unit` — currency, timezone,
  rental catalog, dock-day minutes, search listing, locale, contact details, all of it;
- `staff_shifts`, `calendar_feeds` and `processor_erasure_obligations` for the **permanent** staff,
  which the reset clears by purged-person id rather than shop-wide, on purpose.

**A test that writes any of those takes a shop of its own.** Ask for the `privateShop` fixture
(`e2e/fixtures.ts`): it mints a fully seeded shop through the same `createDemoShop` the live-demo
funnel uses, signs `page` in as its owner, and hands back `{ slug, ownerEmail }` to use everywhere
the spec used to say `blue-mantis`. It is lazy — only a test that destructures it pays — and it
needs no teardown, because the next test's reset purges minted demo shops. Budget for it with
`test.setTimeout` (a mint plus a live sign-in is ~3s, and test-scoped fixture setup runs inside the
test's own timeout), and do not also call `signedInAsOwner()` in that file: the two would race for
the same cookie. A private shop carries no back-filled history (`seedHistory` pins globally-unique
token hashes), so a test that needs the trailing quarter of orders must instead confine itself to
what the reset restores. See ADR 20260815-per-test-private-shops.

Two shapes that look like the answer and are not:

- **A `finally` that puts the setting back.** Nothing enforces it, reviewers do not notice its
  absence, and it does not survive the failure it exists for. Three specs relied on one; they now
  take a private shop instead.
- **A unique-per-run slug on a trial shop you onboard yourself.** That *is* isolation, and it is the
  right tool when the flow under test is onboarding. Just never hard-code the slug — a fixed one
  collides with itself the moment the same database sees the spec twice.

## Functional E2E rules

- Import `test` and `expect` from `e2e/fixtures`, not directly from `@playwright/test`, so tests get per-worker server routing and reset isolation.
- Exercise real Next, Auth.js, and PGlite boundaries. Disable third-party HTTP in the server and abort browser-only Google Maps requests.
- Reuse the per-worker owner session with `signedInAsOwner()` for staff flows; keep auth lifecycle coverage on the live sign-in form.
- Keep safety-critical failure paths (capacity, waiver/medical state, cert/nitrox gating, and manifest/roll call) explicit.

## Locator visibility: the page fixture handles it, but know why

`cacheComponents` is on (ADR 20260801-cache-components-e2e-activity-migration, landed), which
means React `<Activity mode="hidden">` keeps a previous route's DOM around (`display:none`) for
instant back-navigation instead of unmounting it. Next's own docs
(`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`'s Testing section) say
`getByRole`, `getByLabel`, and `getByPlaceholder` are already visibility-safe because they query
the accessibility tree — **that claim did not hold up against this app.** Phase 2 of the migration
found real, reproducible strict-mode failures from `getByRole`/`getByLabel` matching a hidden
Activity route's leftover content (a stale `<input>` from a previous page's form, a stale
`role="alert"`), not just `getByText`.

The fix lives at the one choke point every spec already imports through: `e2e/fixtures.ts`'s
`page` fixture patches `getByText`, `getByRole`, `getByLabel`, and `getByPlaceholder` to
`.filter({ visible: true })` automatically. **You do not need to add the filter yourself on
`page.<query>(...)` calls** — write specs normally, default to `getByRole`/`getByLabel` for
anything with an accessible role or label, and reach for `getByText` only when there's no role/
label to query (plain prose, a status message).

What you *do* need to handle yourself:

- **A second actor's page.** `browser.newContext()`/`context.newPage()` creates a `Page` instance
  the fixture never touches. Wrap it: `const staffPage = makeActivitySafe(await
  staffContext.newPage());` (also exported from `./fixtures`). `pnpm check:e2e-fixtures` flags an
  unwrapped `.newPage()` call.
- **A raw `.locator()`** (CSS/text selector, or an XPath escape hatch like `xpath=..`) used as a
  final matcher — a direct `.click()`, `.fill()`, a count/visibility assertion — needs its own
  `.filter({ visible: true })`. One that only scopes a subsequent `.getByRole()`/`.getByLabel()`/
  `.getByText()` chain is safe by inheritance and needs nothing.
- **Elements with no layout box** (`<script>`, `<meta>`, a closed `<select>`'s `<option>`
  children) are never "visible" to Playwright even when genuinely present — `.filter({ visible:
  true })` on one of these always zero-matches and hangs or fails. Leave these unfiltered; a
  one-line comment at the call site explaining why is enough.
- **An intentional hidden-element assertion** (`toBeHidden()`, an `aria-hidden` backdrop) should
  bypass the fixture's default with `page.locator(...)` rather than lose the check.

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
