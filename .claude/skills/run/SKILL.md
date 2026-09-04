---
name: run
description: Start, wait for, or stop the local dev server; look at a change in the real app; or work out why it died, refuses to start, or answers on the wrong port.
---

# Run

`pnpm dev` runs `next dev` under `scripts/dev-server.mjs`, which is where every surprising thing
about running this app locally is handled. Read this before inventing a launcher; sessions have
written one each, and they all get the same three things wrong.

## Start it and wait

```bash
pnpm dev > /tmp/dev.log 2>&1 &
```

Then wait for **one line**:

```
dev: serving http://localhost:3000 — warmed in 11.7s
```

That is the readiness signal. Poll for it, or poll the route it polls:

```bash
curl -sf --max-time 120 localhost:3000/api/health   # 200 = compiled, migrated, seeded, answering
```

**Never wait on `✓ Ready in 400ms`.** Next prints it when it has bound a socket, which here is up to
twenty-six seconds before it can serve a page — the first request pays for Turbopack's compile and
PGlite's migrate-and-seed. It is also printed *before* Next checks the dev lock, so a second server
that is about to refuse announces success first. A session that trusts that line watches its first
request hang, concludes the server is wedged, kills it, and buys another cold start. That is the
single most expensive mistake available here.

Never write a wait whose only exit is the success marker — give it a timeout and a failure branch
(AGENTS.md's hard rules). The server can legitimately fail to come up.

## The lines the supervisor prints

All of them start `dev:`. Everything else is Next's own output, passed through untouched.

| Line | What it means |
| --- | --- |
| `database: PGlite in .pglite` | What it opened. If this says `postgres at …` you have a stale `.env.local` and local dev is pointed at a real database |
| `memory budget 8198 MB of 13664 MB` | The budget, derived from the cgroup limit that would actually kill it — not `os.totalmem()` |
| `serving http://localhost:3000 — warmed in Ns` | It can answer. The port is the real one |
| `NNNN MB — over the … budget` | Noted, nothing done. Expected during heavy work |
| `restarting: idle, holding …` | It restarted while nothing was in flight. Cost nothing. Not a bug |
| `restarting now: … past the … mark` | It restarted mid-request to stay ahead of the kernel. The request in flight was lost. Also not a bug |
| `the dev server died … Restarting` | The kernel got there first. Next prints nothing at all when that happens; this line is the only record |
| `giving up on the … budget` | Three restarts in a minute all came back over the line, so the budget is below what this app needs at rest and no restart can meet it. Supervision switches off, the server keeps running. Raise `DIVEDAY_DEV_MEMORY_BUDGET_MB`, or read it as the machine being too small |
| `port 3000 belongs to another process, so Next took 3001` | Read 3001. Whatever answers on 3000 is a different app, and it will look exactly like your change not landing |
| `next dev refused to start` | Read Next's own message above it — it names the pid holding the checkout |

Why any of this exists: `next dev` here never unloads a route it has served (155 MB at boot, 1.4 GB
after one page, 13 GB and OOM-killed after ~30 routes) and no Node flag bounds it, because the memory is
Turbopack's rather than V8's. ADR 20260903-the-dev-server-is-supervised has the measurements.

## Look at a change

```bash
node scripts/screenshot.mjs /s/blue-mantis /shop/blue-mantis --as owner
```

Light and dark × phone and desktop, into `screenshots/` (gitignored). `/shop/**` signs itself in
through the seeded dev credentials. It needs a server already running and does not start one.

A capture matrix over staff pages runs to about 12 GB, so the supervisor may restart underneath it;
the script retries a capture once when the connection drops and says so. A *second* failure is
real — read it rather than re-running.

For review-grade pixels use a filtered visual-spec run instead (the `design-review` skill): that
path uses the frozen clock and seeded data, so the pixels are CI's pixels.

## Stop it

Signal the supervisor, not the `pnpm` wrapper above it:

```bash
kill $(pgrep -f 'scripts/dev-server.mjs')
```

It kills its whole process group on the way out, so nothing is left behind. Killing the `pnpm`
wrapper instead leaves `next dev` and `next-server` running and reparented to init — the orphan
class `scripts/stray-processes.mjs` exists to report. Stop the server before you finish a turn;
`node scripts/stray-processes.mjs --list` is the honest check, because `TaskList` has reported "no
tasks" with a live shell twice.

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
  It is not the cause of a stale render, and deleting it buys a cold boot and fixes nothing.

When something is wrong rather than merely slow, the `debug` skill's symptom table has the rest.
