---
name: debug
description: Debugging playbook — failing tests, red CI, Playwright flakes, Drizzle/PGlite errors, Next 16 surprises, auth redirect loops, and a local dev server that died, refuses to start, or serves stale data. Use whenever investigating a bug report, a red check, or unexpected runtime behavior, BEFORE attempting fixes.
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
- **A visual capture shard red with `wedged, not slow` in its log** — the known unattributed
  Chromium renderer wedge; see the e2e-and-visual skill's renderer-wedge section. CI reruns
  only the failed captures once when that verdict is present; a run that is still red either
  wedged twice (rare — re-run and note it) or failed for a second, real reason in the same log.
- **`reg-suit visual regression` red with "No visual baseline published"** — a consequence,
  not a cause: some visual shard failed, so main published no snapshot. Fix the shard's
  failure; a green re-run publishes the baseline.
- **A real spec failure** — only now is it yours to root-cause with the loop above. Check
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
   is the *reused*-server trap above, not CI's problem).

## Where evidence lives

| Symptom | Look at |
|---|---|
| Playwright failure | `test-results/<spec>/error-context.md` (error + page snapshot) and trace zips |
| Element found twice (strict mode) | Next's route announcer is also `role="alert"` — filter locators by text |
| First-navigation timeouts in e2e | The fleet runs precompiled `next start` servers, so slowness isn't compile cost — assert `toHaveURL` first; expect timeout is 8s, test timeout 15s (`playwright.config.ts`) |
| `Test timeout … exceeded while setting up "<fixture>"` | The named fixture is rarely the slow one — Playwright names whichever is in flight when the budget runs out, and the budget covers **test-scoped** fixture setup but not worker-scoped. Download the run's `playwright-report-<shard>` artifact and read the "Before Hooks" per-fixture durations; that is where the real cost shows (ADR 20260730-pinned-browser-visual-determinism) |
| Test can't see a new column/table | No migration yet — see the `schema-change` skill |
| **The dev server is gone — `ECONNREFUSED`, and its log just stops mid-line** | It ran out of memory and the kernel took it; nothing prints, in any log, ever. `dmesg \| grep -i oom` is the only record. Under `pnpm dev` the supervisor gets in front of this and restarts with a `dev:` line saying so, so a *silent* death means something started `next dev` directly. Measured: 155 MB at boot, 1.4 GB after one page, 13 GB after ~30 routes (ADR 20260903-the-dev-server-is-supervised). Not your change, and no Node flag bounds it — the memory is Turbopack's, outside the V8 heap |
| `dev: restarting: idle, holding N MB` / `dev: restarting now: …` | Working as intended, not a bug to chase. The idle one costs nothing; the other loses the request in flight to stay ahead of the kernel. Either way the next compile is warm. `DIVEDAY_DEV_MEMORY_BUDGET_MB` moves the line, `0` turns it off |
| `pnpm typecheck` reports syntax errors in `.next/dev/types/*.d.ts` — "Unterminated string literal" in a file you never wrote | Your code is fine. `next dev` rewrites those generated types non-atomically, so a concurrent `tsc` reads one half-written. Stop the dev server and run it again; measured clean the moment the server is down and seven fake errors while it is up |
| `⨯ Another next dev server is already running` | The lock is `.next/dev/lock`, one per **checkout** — `--port` does not buy a second server, and a probe server on any port blocks you. Stop the pid Next names, or take a `git worktree`. Next prints its whole banner including `✓ Ready` *before* it tries the lock, so a doomed start announces success first |
| Your change isn't showing, or the page looks like a different app | Check the port the supervisor named. Next answers an occupied 3000 by quietly taking 3001; a session that keeps reading 3000 is reading whatever other project owns it. The `dev: serving http://localhost:N` line is the authority |
| `[WARN] Unsupported engine: wanted: {"node":"^24.15.0"}` on every `pnpm` command | Expected, and safe to ignore, in an agent container: this project runs Node 24 (ADR 20260903-node-24-is-the-floor) and these containers ship 22. Nothing enforces it, so everything works. What it is *not* is cosmetic — pnpm writes that line to **stdout**, first, ahead of your script's own output, on `pnpm <script>` and `pnpm install` but not `pnpm exec`. So never pipe a `pnpm` script into anything that parses: it is the row below, and it cost this project both MCP servers for a day. `pnpm check:node-version` keeps the declarations agreeing; nothing can remove the warning short of a container on 24 |
| An MCP server's tools are missing, or it times out at session start | Nothing in `.mcp.json` may be launched through `pnpm`/`npm`/`npx`: those write their own warnings (`[WARN] Unsupported engine`) to **stdout**, which is the JSON-RPC channel, so the handshake never parses and the server dies on a 30s connect timeout. Point `command` straight at `./node_modules/.bin/<bin>`; `pnpm check:agents` enforces it |
| Stale/weird dev data | `pnpm db:reset` (wipes `.pglite/`; next boot re-migrates + re-seeds). It **refuses while a dev server is running** and names the pid: deleting the directory under a live server does not reach that server, which keeps answering from the handles it holds and discards every later write on exit |
| `<dir> is already open by process N` at boot | Working as intended. PGlite takes no lock of its own, so `src/db/data-dir-lock.ts` takes one — two openers of one `.pglite` fork the database silently and the last to close overwrites the other. Stop the pid it names, or give this process `PGLITE_DATA_DIR=<somewhere else>`. A claim left behind by a *killed* server is swept up automatically, so this never means "delete the lock file" |
| Random e2e write failures, reads fine | A leaked `next dev` from an earlier screenshot/verify session holding a deleted `.pglite` — check `curl localhost:3000`, kill it, rerun |
| Vitest timeout on db tests | Each test boots PGlite; ceiling is 20s in `vitest.config.ts` — a hang usually means an unresolved promise, not slowness |
| CI failure | The failed step's log tail only — never stream full job logs |
| `e2e` job red on `e2e/visual.spec.ts` assertions | Not necessarily a bug to fix — it's an untriaged visual diff. Run the `visual-triage` skill |
| Visual capture log says "wedged, not slow" | The renderer stopped answering — the known, unattributed Chromium wedge, already probed and classified by the harness. Not app or spec code; see the e2e-and-visual skill's renderer-wedge section before touching anything |
| `page.screenshot` blows the *test* timeout despite its own `timeout:` option | That option bounds preparation, not the protocol call — on a wedged renderer it never fires (measured: 95s past a 15s timeout, run 31147282309). `screenshotOrGiveUp` in visual.spec.ts is the driver-side bound; use it for any new screenshot |
| axe reports `document-title` on a scan | The rule is disabled in `expectNoA11yViolations` for a reason (see its comment): React's streamed-metadata swap leaves a transient empty `<title>` no page-side wait can close. The real guarantee is the `toHaveTitle` gate above the scan |
| A page body with no `__reactFiber$` on anything, and `<!--$~-->` markers that never resolve | The tab is hidden, not the build broken — React's batched reveal waits on an animation frame. See the hidden-tab section above; `document.hidden` answers it in one line |
| Framework behaving "wrong" | This is **Next 16** — check `node_modules/next/dist/docs/` before assuming our bug (middleware→proxy, async `searchParams`, `connection()`) |
| Redirect loops / auth bounces | Two layers run: `src/proxy.ts` (edge, redirects to `/sign-in` or `/`) and `requireStaffSession()` (server). Identify which bounced before changing either |
| `scripts/screenshot.mjs` says sign-in was refused, or a `/shop/**` capture stalls on `/sign-in` | The server was started without `DIVEDAY_RATE_LIMIT_DISABLED=1` (`pnpm dev` sets it; a bare `next dev` does not) and the 8-per-email sign-in budget is spent — restart it with the flag, never wait the 15 minutes out. The page reads the same for a wrong password, so compare the credentials with `src/db/dev-credentials.ts` first |
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

A written justification is a claim, and claims here get checked: a 2026-08-06 review found three
shipped workarounds whose comments confidently explained mechanisms that were false ("a sibling
test's parallel worker", "a permanent redirect" that measured as a 200). Before committing a
comment that explains *why* a workaround is needed, verify the mechanism it names against the
harness or the code (`e2e/servers.ts` for worker isolation, an actual `curl -i` for a status
code). If you can't verify it, write "unverified hypothesis" — a wrong explanation with a
confident voice costs the next session far more than an honest gap.
