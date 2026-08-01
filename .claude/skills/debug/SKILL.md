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
