# Debug: where evidence lives, and background processes

Part of the **debug** skill ([SKILL.md](SKILL.md)). Read it to find the artifact a symptom points at (Playwright, Drizzle/PGlite, Next 16, auth, a dead dev server), and before backgrounding a server.

## Where evidence lives

| Symptom | Look at |
|---|---|
| Playwright failure | `test-results/<spec>/error-context.md` (error + page snapshot) and trace zips |
| Element found twice (strict mode) | Next's route announcer is also `role="alert"` — filter locators by text |
| First-navigation timeouts in e2e | The fleet runs precompiled `next start` servers, so slowness isn't compile cost — assert `toHaveURL` first; expect timeout is 8s, test timeout 15s (`playwright.config.ts`) |
| `Test timeout … exceeded while setting up "<fixture>"` | The named fixture is rarely the slow one — Playwright names whichever is in flight when the budget runs out, and the budget covers **test-scoped** fixture setup but not worker-scoped. Download the run's `playwright-report-<shard>` artifact and read the "Before Hooks" per-fixture durations; that is where the real cost shows (ADR 20260730-pinned-browser-visual-determinism) |
| Test can't see a new column/table | No migration yet — see the `schema-change` skill |
| `⨯ Error: The destination stream closed early.` in a run that **passes** | Not a defect. It is React's own cancellation text — `createCancelHandler` fires on the destination stream's `close` event — so it means a client closed a streaming response before React finished writing it. In the e2e suite the closer is nearly always a `<Link>` prefetch (`?_rsc=`) that the next `page.goto` abandoned, which is what a prefetch is for. The same line *can* mark a real action-race, so the discriminator is whether an assertion sits between the click and the navigation; the full finding and the measurement are in [docs/agents/repo-checks.md](../../../docs/agents/repo-checks.md)'s action-race section (issue 1560) |
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
| `e2e` job red on an `e2e/visual-*.spec.ts` assertion | Not necessarily a bug to fix — it's an untriaged visual diff. Run the `visual-triage` skill |
| Visual capture log says "wedged, not slow" | The renderer stopped answering — the known, unattributed Chromium wedge, already probed and classified by the harness. Not app or spec code; see the e2e-and-visual skill's renderer-wedge section before touching anything |
| `page.screenshot` blows the *test* timeout despite its own `timeout:` option | That option bounds preparation, not the protocol call — on a wedged renderer it never fires (measured: 95s past a 15s timeout, run 31147282309). `screenshotOrGiveUp` in visual.spec.ts is the driver-side bound; use it for any new screenshot |
| A hydration mismatch naming a client component of ours, whose diff line is `style={{caret-color:"transparent"}}` | The camera, not the app. Playwright's screenshot hides the caret by writing that inline style onto every element and taking it off after, so a shot taken while a component is still hydrating leaves React comparing its render against a DOM carrying an attribute nothing rendered. `scripts/screenshot.mjs` passes `caret: "initial"` for exactly this reason; a capture written by hand without it reintroduces the warning. Nothing in this repository sets `caret-color` — grep before believing the component named (issue #1593) |
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
