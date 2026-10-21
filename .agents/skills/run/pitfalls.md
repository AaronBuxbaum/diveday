# Run: things that will otherwise cost you an hour

Part of the **run** skill ([SKILL.md](SKILL.md)). Read it before a second server, a seed edit, a type-check or build while the server runs, or when the disk or the database looks wrong.

## Things that will otherwise cost you an hour

- **One dev server per *checkout*.** The lock is `.next/dev/lock` and it holds the whole directory,
  so `--port` does not buy a second one and a probe server on any port blocks you. Need two? Use a
  `git worktree`.
- **One process at a time on `.pglite`,** and it is enforced now rather than remembered: a
  `pnpm build` beside a running `pnpm dev` is refused with `is already open by process N`. PGlite
  takes no lock of its own — both would open it, both succeed, each sees only its own writes, and
  the last to close overwrites the other with nothing printed — so `src/db/data-dir-lock.ts` takes
  one from outside it. Stop the pid it names, or set `PGLITE_DATA_DIR` to give this process its
  own. A claim left behind by a killed server is swept up by the next start, so there is never a
  lock file to delete by hand.
- **A seed edit needs `pnpm db:reset`, not a restart.** `seedProductionDb` returns early once the
  demo shop exists. A *migration* only needs a restart.
- **`pnpm e2e` runs a full production build first.** Give it a spec — `pnpm e2e <spec>
  --reporter=line` — and never a bare `--` before arguments (pnpm forwards it and the filter is
  silently dropped). The whole suite belongs to CI.
- **Stop the server before anything that type-checks** — `pnpm typecheck`, `pnpm build`, and
  `pnpm e2e` (whose `e2e:build` does). `next dev` rewrites `.next/dev/types/*.d.ts`
  non-atomically, and killing it mid-write leaves them half-finished: dozens of `TS1005` and
  "Unterminated string literal" errors in generated files nobody wrote, and they persist until
  something rewrites them. `rm -rf .next/dev/types` clears it — Next regenerates them — and the
  errors are never in your code. Cost one full e2e run to rediscover on 2026-09-03.
- **`.next` grows without bound** (about 2 GB across a working day, mostly Turbopack's cache).
  It is not the cause of a stale render, and deleting it buys a cold boot and fixes nothing — with
  one exception the supervisor handles for you: the state a *killed* server leaves, which can
  answer a route 404 in ~50 ms without entering the page. `pnpm dev` discards that on its next
  start; a bare `next dev` does not, so start the server through `pnpm dev`.

When something is wrong rather than merely slow, the `debug` skill's symptom table has the rest.
