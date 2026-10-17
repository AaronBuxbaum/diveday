# Debug: Playwright flakes, races and hydration

Part of the **debug** skill ([SKILL.md](SKILL.md)). Read it when a Playwright spec fails intermittently, times out, or a page renders but never responds.

## A flake that looks like slowness usually isn't — falsify that first

"It's probably contention" is the easiest explanation to reach for and the hardest to be wrong
about without checking, because it's rarely *fully* wrong — some genuine scheduling cost is
almost always present, which makes it feel confirmed by a first pass of evidence. It is also
frequently not the actual, fixable cause. Don't stop at "plausible and hard to disprove." Run the
one experiment that actually distinguishes them:

**Double the relevant timeout (`playwright.config.ts`'s `expect`/`timeout`, temporarily, never
committed) and rerun on a freshly-started server — not a reused one; see the reused-server trap
below.** A genuinely slow request resolves given enough time. If the same assertion still fails at
2-4x the budget, the underlying operation is not slow, it is **stuck or already wrong**, and no
amount of waiting will ever make it pass:

- **Stuck**: an awaited call with no timeout of its own — a raw `dns.lookup()`/`fetch()` outside
  any `AbortController`, a DB call outside a statement timeout. `DIVEDAY_DISABLE_EXTERNAL_HTTP`
  and similar env-gated stubs only cover the call sites someone remembered to check the flag —
  grep for the underlying primitive (`dns.lookup`, a bare `fetch(`) across `src/lib`/`src/db`
  directly; a new call site added later is silently ungated until someone greps again.
- **Already wrong**: the assertion is polling for a value that was already lost or corrupted
  *before* it started — most commonly a Playwright interaction racing the page's own hydration.
  The **first** `.fill()`/`.click()` right after `page.goto()` (or a client-side `<Link>`
  transition) can succeed against the DOM, then get silently overwritten when hydration finishes
  reconciling a moment later — a later interaction on the same page, once hydration has settled,
  does not lose this race. `test-results/<spec>/error-context.md`'s DOM snapshot proves it: a
  field that should read empty/edited but still shows its original server-rendered value means the
  edit was lost, not merely slow. The fix is almost never "wait longer" (there's nothing to wait
  for) — reorder so the vulnerable interaction happens *last*, immediately before the action that
  submits it, once other interactions have proven the page is settled.

Contention still matters as an **amplifier**, not necessarily the cause: slower hydration under
CPU load widens the window a hydration race can lose in, which is exactly why "worse under 2
workers" and "not actually caused by scarce CPU" are both true at once. Don't let the correlation
stand in for the mechanism.

**"Once hydration has settled" can itself be more than one wave — and the fix belongs in the app,
not the test.** `cacheComponents` was observed (`RosterBulkWaiverSelection.tsx`'s bulk-waiver
selection) remounting a page's dynamic content a second time, up to ~1s after the first paint
already looked interactive, silently discarding whichever checkbox had just been ticked. A single
successful interaction, or a fixed delay picked by trial and error, doesn't prove no further
remount is coming — logging each mount's timestamp (a `console.log` in the component's own
mount/unmount effect, read back via `page.on("console", ...)` in the test) is what actually proved
it, ruling out `networkidle` (the remount still happened after the network went idle) before
looking for a fix.

The concrete fix wasn't a smarter e2e wait; it was moving the state out of the part of the tree
that re-renders. Any page under `cacheComponents` can get a second, fresher render of its own
dynamic content below its `<Suspense>` boundary — a route's own layout (`layout.tsx`), by contrast,
stays mounted across that same-route re-render (that's the whole reason `trips/[id]/layout.tsx`
hoists the sub-nav there instead of repeating it per page). State that must survive a same-route
mutate-then-redirect belongs in that layout, not the page body — with a `usePathname()`-keyed reset
effect so it still clears on a *real* navigation (the same idiom ADR
20260801-cache-components-activity-state already uses for `InlineConfirm`/`ScheduleBuilder`, just
applied in the opposite direction: there it stops state from *surviving* too long, here it lets
state survive at all). Once the state was moved, the e2e test needed nothing more than the same
`data-hydrated` boolean every other controlled field already uses — no stability poll, no per-mount
id. If a fixed wait or a stability poll is the best fix you can find for a remount-losing-state bug,
you likely haven't found the actual boundary that's re-rendering yet.

A `Protocol error (Runtime.callFunctionOn): Internal server error, session closed` in the same
failure block as `Test timeout of Nms exceeded` is usually a **downstream artifact** of that same
timeout — Playwright tears down the page to abort whatever's hanging, and an in-flight locator
poll surfaces that teardown as a session-closed error. It is easy to misread as an independent
Chromium crash / resource-exhaustion signature. It isn't, on its own — find and read the *primary*
error in the same block before concluding the browser itself is unstable.

**The reused-server trap**: iterating with `pnpm exec playwright test <file>` run repeatedly
against the same long-lived `next start` (`reuseExistingServer: true` locally) reruns the demo
reset before every test, but the reset only restores what `resetDemoSchedule` explicitly touches —
a shop-settings column or other non-schedule state a test mutates and never restores stays mutated
for every subsequent invocation against that same process, real CI never hits this (fresh servers
every job), so a failure that reproduces locally on rerun #2+ but not #1 is diagnostic of a missing
reset line, not of the bug under investigation. Kill and restart the server between diagnostic runs
whenever a failure's reproducibility looks reuse-dependent, and check `resetDemoSchedule` for
what's actually being reset before trusting a "same test fails every time" pattern as evidence
against timeout-based experiments above.

**A whole-suite local run that fails only in its tail is the same trap wearing a different
costume, and it is *the* case that gets misread as contention.** `pnpm e2e` runs one `next start`
per worker for all 305 tests (~150 each), while every CI job shards onto a fresh server (~76 each)
— so a per-reset cost that grows with the server's age blows the 15s per-test budget locally and
never shows up on CI at all. The signature is a cluster of `Test timeout` failures in whatever
specs happen to sort last (`visual`, `waivers`, `whatsapp-settings`), several of them
`while setting up "demoReset"`, in specs the diff never touched — and they pass in isolation.
That looks *exactly* like a loaded machine, which is why it has been written off as one more than
once. It is not: run resets against a bare server in a loop and time them
(`curl -w "%{time_total}" -X POST -H "authorization: Bearer $DIVEDAY_E2E_SECRET"
127.0.0.1:$E2E_BASE_PORT/api/test/reset`, after setting `E2E_BASE_PORT` to the running fleet's
derived base or an explicit override) — a flat curve exonerates the server and sends you back to the
test, a rising one is a real defect with a row count behind it. `/api/test/reset` vacuums for this
reason (PGlite ships no autovacuum, so ~4,400 dead tuples and ~2MB of heap per reset used to
accumulate forever); `src/app/api/test/reset/reclaim.test.ts` is the guard. Before blaming the
box, confirm the port you are measuring is not still held by an *earlier* probe's server — a stale
listener silently answers on the pre-fix build and reports its own bloated curve as the new one.

## A race is fixed by naming what you wait for

`pnpm check:e2e-hygiene` refuses sleeps, `networkidle`, and retry shims in `e2e/` because every
one of them has already been tried here and failed the same way — by moving the race instead of
closing it:

- The offline-fallback assertion was "fixed" three times, each fix re-anchoring the same race one
  layer down (error text → interstitial DOM → an interstitial that is empty on CI), before the
  version that asserted **what the page shows when the work is done**.
- `findTripOnBoard` retried its crawl 3× under a written justification ("a sibling worker shifts
  pagination") that was impossible — each worker owns an isolated database. The real race was a
  client navigation landing on the segment's linkless `loading.tsx` skeleton; the fix was waiting
  for a link that exists only on the destination page and never in the skeleton.

The pattern behind both fixes: pick an element that **exists only after** the awaited work
completed — the destination page's own content, never absence-of-spinner, never elapsed time —
and let an auto-retrying `expect(locator)` wait for it. Under streaming SSR and `cacheComponents`,
"the page navigated" and "the page's content exists" are separate events; a `loading.tsx` skeleton
answers the first while failing the second, which is why URL- and time-based waits race and
content waits don't.

## A page body that never hydrates is a hidden tab, not a broken build

React 19.2 batches the reveal of server-rendered Suspense boundaries. The streamed content lands in
a staging `<div id="S:n">` at the end of `<body>`, and the inline `$RC` script only *queues* it —
it marks the boundary `<!--$~-->` and pushes the pair onto `$RB`. The move into the boundary
(`$RV`), and the hydration retry that follows it, are scheduled with **`requestAnimationFrame`**
for a document's first batch — read the emitted script in `node_modules/react-dom/cjs/`, not from
memory. A hidden document never gets an animation frame, so everything below a `loading.tsx`
boundary sits in its staging div — visibly the skeleton, and with no React fiber on a single
control — for as long as nobody looks at the tab.

That is the whole of "staff page bodies never hydrate under `pnpm dev`, so a form tap does a native
POST" (FU-20260820, closed 2026-08-21). It was measured through an automation surface whose tab is
permanently `document.visibilityState === "hidden"` — Claude Code's Browser pane is one — and
compared against a production build measured through a visible Playwright page. The two builds are
identical at the same visibility; only the observer differed:

| build | tab | hydrated / total on `/sign-in` | boundary markers | `$RB` |
| --- | --- | --- | --- | --- |
| `next dev` (Turbopack, Cache Components) | hidden | 0 / 35 | 6 × `$~` | 12 |
| `next build` + `next start` | hidden | 0 / 35 | 6 × `$~` | 12 |
| either | visible | every control | all `$` | 0 |

So ask the page whether anyone is looking at it before diagnosing anything else:

```js
({ hidden: document.hidden, staged: document.querySelectorAll('div[id^="S:"]').length,
   queued: window.$RB && window.$RB.length })
```

`hidden: true` with a non-empty `$RB` is this and nothing else. It heals the instant a frame is
painted, which is also the trap: **a screenshot forces a frame**, so a capture taken between two
measurements silently repairs what you were measuring, and one page reads broken and then fine in
the same session. Look at UI through `node scripts/screenshot.mjs` or a Playwright page — both
visible — and keep the Browser pane for reading a DOM, never for deciding whether the app works.
