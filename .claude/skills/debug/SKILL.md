---
name: debug
description: Debugging playbook — failing tests, red CI, Playwright flakes, Drizzle/PGlite errors, Next 16 surprises, auth redirect loops. Use whenever investigating a bug report, a red check, or unexpected runtime behavior, BEFORE attempting fixes.
---

# Debug

## The loop

1. **Reproduce first.** Turn the report into a failing test before touching a fix — a Vitest
   case (PGlite integration for data bugs) or a Playwright spec for flow bugs. The failing test
   proves the diagnosis; keeping it proves the cure and pins it forever.
2. **Read the actual error, not the wrapper.** Drizzle wraps Postgres errors — the real error
   and constraint name are in the `error.cause` chain; walk it before speculating.
3. **Isolate fast.** `pnpm exec vitest run <file> -t "<name>"` ·
   `pnpm exec playwright test e2e/<file>.spec.ts:<line>`. Iterate on the single failing case,
   then rerun the full gate.
4. **Three failed fix attempts on the same symptom → stop.** Write down what's known and ruled
   out, then re-question the diagnosis. A fourth variation of the same guess is how sessions
   burn hours.

## Where evidence lives

| Symptom | Look at |
|---|---|
| Playwright failure | `test-results/<spec>/error-context.md` (error + page snapshot) and trace zips |
| Element found twice (strict mode) | Next's route announcer is also `role="alert"` — filter locators by text |
| First-navigation timeouts in e2e | Dev-server compile cost — assert `toHaveURL` first; expect timeout is already 15s |
| Test can't see a new column/table | No migration yet — see the `schema-change` skill |
| Stale/weird dev data | `pnpm db:reset` (wipes `.pglite/`; next boot re-migrates + re-seeds) — but **kill any running dev server first**: wiping the directory under a live PGlite handle poisons that server (writes start failing with DrizzleQueryError), and Playwright's `reuseExistingServer` will happily run the suite against it |
| Random e2e write failures, reads fine | A leaked `next dev` from an earlier screenshot/verify session holding a deleted `.pglite` — check `curl localhost:3000`, kill it, rerun |
| Vitest timeout on db tests | Each test boots PGlite; ceiling is 20s in `vitest.config.ts` — a hang usually means an unresolved promise, not slowness |
| CI failure | The failed step's log tail only — never stream full job logs |
| Framework behaving "wrong" | This is **Next 16** — check `node_modules/next/dist/docs/` before assuming our bug (middleware→proxy, async `searchParams`, `connection()`) |
| Redirect loops / auth bounces | Two layers run: `src/proxy.ts` (edge, redirects to `/sign-in` or `/`) and `requireStaffSession()` (server). Identify which bounced before changing either |
| Sign-in silently fails in dev | `verifyCredentials` returns null for four distinct reasons (no account, disabled, bad password, no staff role) by design — check the seeded account state, don't add error leakage |

## Honesty

Report failures verbatim. If you couldn't verify something (denied permission, CI didn't run),
say so explicitly — never describe partial work as done.
