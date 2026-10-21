# Run: the lines the supervisor prints

Part of the **run** skill ([SKILL.md](SKILL.md)). Read it when a `dev:` line appears that you do not recognise, or the server restarts, refuses to start, or answers on the wrong port.

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
| `the last dev server in this checkout was killed rather than stopped …` | It threw away the build state in `.next/dev` that a killed server left, because a killed compile can leave routes answering 404 before any page code runs (issue #1882). This start compiles cold. A clean stop or restart keeps the warm cache |

Why any of this exists: `next dev` here never unloads a route it has served (155 MB at boot, 1.4 GB
after one page, 13 GB and OOM-killed after ~30 routes) and no Node flag bounds it, because the memory is
Turbopack's rather than V8's. ADR 20260903-the-dev-server-is-supervised has the measurements.
