---
name: debug
description: Debugging playbook — failing tests, red CI, Playwright flakes, Drizzle/PGlite errors, Next 16 surprises, auth redirect loops. Use whenever investigating a bug report, a red check, or unexpected runtime behavior, BEFORE attempting fixes.
---

# Debug

## Ownership

A failing or flaky test is part of the work, even when it's unrelated to what you set out to do —
fix it, don't route around it (`.skip`, a widened timeout, a deleted assertion) or leave it red
for someone else. Before starting the fix, search the repo's open PRs for one that already
touches the same spec or test name (see AGENTS.md **Parallel work**). Two sessions racing to fix
the same flake produce conflicting patches; if another PR already owns it, coordinate in that
thread instead of pushing a second, competing fix.

## The loop

1. **Reproduce first.** Turn the report into a failing test before touching a fix — a Vitest
   case (PGlite integration for data bugs) or a Playwright spec for flow bugs. The failing test
   proves the diagnosis; keeping it proves the cure and pins it forever.
2. **Read the actual error, not the wrapper.** Drizzle wraps Postgres errors — the real error
   and constraint name are in the `error.cause` chain; walk it before speculating.
3. **Isolate fast.** `pnpm exec vitest run <file> -t "<name>"` ·
   `pnpm exec playwright test e2e/<file>.spec.ts:<line>`. Iterate on the single failing case,
   then rerun the full gate. For a Playwright bug, `pnpm e2e:build` once, then
   `pnpm e2e:run e2e/<file>.spec.ts --reporter=line` reruns without paying for another build.
4. **Three failed fix attempts on the same symptom → stop.** Write down what's known and ruled
   out, then re-question the diagnosis. A fourth variation of the same guess is how sessions
   burn hours.

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
127.0.0.1:3100/api/test/reset`) — a flat curve exonerates the server and sends you back to the
test, a rising one is a real defect with a row count behind it. `/api/test/reset` vacuums for this
reason (PGlite ships no autovacuum, so ~4,400 dead tuples and ~2MB of heap per reset used to
accumulate forever); `src/app/api/test/reset/reclaim.test.ts` is the guard. Before blaming the
box, confirm the port you are measuring is not still held by an *earlier* probe's server — a stale
listener silently answers on the pre-fix build and reports its own bloated curve as the new one.

## Where evidence lives

| Symptom | Look at |
|---|---|
| Playwright failure | `test-results/<spec>/error-context.md` (error + page snapshot) and trace zips |
| Element found twice (strict mode) | Next's route announcer is also `role="alert"` — filter locators by text |
| First-navigation timeouts in e2e | The fleet runs precompiled `next start` servers, so slowness isn't compile cost — assert `toHaveURL` first; expect timeout is 8s, test timeout 15s (`playwright.config.ts`) |
| `Test timeout … exceeded while setting up "<fixture>"` | The named fixture is rarely the slow one — Playwright names whichever is in flight when the budget runs out, and the budget covers **test-scoped** fixture setup but not worker-scoped. Download the run's `playwright-report-<shard>` artifact and read the "Before Hooks" per-fixture durations; that is where the real cost shows (ADR 20260730-pinned-browser-visual-determinism) |
| Test can't see a new column/table | No migration yet — see the `schema-change` skill |
| Stale/weird dev data | `pnpm db:reset` (wipes `.pglite/`; next boot re-migrates + re-seeds) — but **kill any running dev server first**: wiping the directory under a live PGlite handle poisons that server (writes start failing with DrizzleQueryError), and Playwright's `reuseExistingServer` will happily run the suite against it |
| Random e2e write failures, reads fine | A leaked `next dev` from an earlier screenshot/verify session holding a deleted `.pglite` — check `curl localhost:3000`, kill it, rerun |
| Vitest timeout on db tests | Each test boots PGlite; ceiling is 20s in `vitest.config.ts` — a hang usually means an unresolved promise, not slowness |
| CI failure | The failed step's log tail only — never stream full job logs |
| `e2e` job red on `e2e/visual.spec.ts` assertions | Not necessarily a bug to fix — it's an untriaged visual diff. Run the `visual-triage` skill |
| Framework behaving "wrong" | This is **Next 16** — check `node_modules/next/dist/docs/` before assuming our bug (middleware→proxy, async `searchParams`, `connection()`) |
| Redirect loops / auth bounces | Two layers run: `src/proxy.ts` (edge, redirects to `/sign-in` or `/`) and `requireStaffSession()` (server). Identify which bounced before changing either |
| Sign-in silently fails in dev | `verifyCredentials` returns null for four distinct reasons (no account, disabled, bad password, no staff role) by design — check the seeded account state, don't add error leakage |

## Long-running background processes (dev server, e2e)

`pnpm dev`/`next dev` and any ad hoc server you background for manual verification never exit on
their own — unlike `pnpm e2e`/`pnpm visual`, which build, run, and terminate. That makes them the
main source of two related failures, both worse in a cloud/remote session where the sandbox can be
reused across separate agent runs (a leaked process from a finished session outlives the
conversation that started it):

- **Stale-server corruption** (already known): a leaked `next dev` holding a deleted/reset
  `.pglite` — see the table above.
- **Stuck waiting on a phantom readiness signal**: if you start a background server and wait
  (Monitor or a log-tail) for a fresh "Ready"/boot line, but something is already bound to that
  port from an earlier, now-orphaned session, your wait never sees the marker it's looking for —
  the real listener already printed that line in a session that's gone. This looks identical to a
  hang, and is the same shape of bug as an orphaned Monitor: the thing you're actually waiting on
  no longer has anyone driving it.

Before backgrounding a dev server (or trusting Playwright's `reuseExistingServer: !process.env.CI`
to reuse one), check what's actually listening: `curl -s localhost:3000 >/dev/null && echo alive`.
If something answers and you didn't just start it, don't assume it's healthy or that it's about to
emit a fresh readiness line — kill it and start clean, exactly as the stale-server row above says.
And if you background a server yourself for verification, stop it before you finish the turn —
don't leave it running "in case it's needed again." Prefer `pnpm e2e`/`pnpm visual` for
verification when they cover the surface (see the `verify` skill): they build, run, and exit on
their own, so there's nothing left over to leak into the next session.

## Honesty

Report failures verbatim. If you couldn't verify something (denied permission, CI didn't run),
say so explicitly — never describe partial work as done.
