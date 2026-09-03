# 20260903-the-dev-server-is-supervised — `pnpm dev` runs under a memory budget and says when it can serve

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

`next dev` in this app has no steady-state memory footprint. It grows with every route it serves,
gives back only part of it, and has no ceiling of its own. Measured on 2026-09-03 against Next
16.3.4 with a warm `.next`, one route at a time, reading RSS of the whole `next dev` tree:

| after | RSS |
| --- | --- |
| boot (`✓ Ready in 407ms`) | 155 MB |
| one request to `/terms` | 1,400 MB |
| twenty routes | 6,796 MB |
| about thirty routes | killed |

The last row is the kernel, not a figure of speech:

```
oom-kill: ... task=next-server (v16.3.4),pid=2542
Memory cgroup out of memory: Killed process 2542 — anon-rss:13,091,384kB
```

That took twelve minutes of ordinary browsing. Three properties of it are what turn a crash into a
long, expensive hunt:

**It leaves no account of itself.** The dev log does not end in an error — it stops mid-line. Every
later request is `ECONNREFUSED`, `.next/dev/logs/next-development.log` says nothing, and the process
that could have explained is gone. The reasonable next move is to look for the bug in whatever
change was in flight, and there isn't one.

**No Node flag bounds it.** With V8's old space capped at 1536 MB the process still reached 5.3 GB
and never raised a heap OOM, so essentially all of it is native — Turbopack's Rust allocations,
outside any V8 limit. `--max-old-space-size` is not a mitigation here; it is a no-op.

**Turbopack's own eviction does not fire.** `experimental.turbopackMemoryEviction` defaults to
`'auto'`, documented as evicting "when we expect to save a lot of memory or the system is under
pressure." Under a cgroup there is no pressure to notice: this container's limit is 13,663 MB while
`os.totalmem()` reports 16,075 MB, so from inside the process nothing looks wrong right up to the
kill. Setting it to `'full'` was measured over the same twenty routes and did not change the
trajectory (5,266 MB against 5,339 MB), which is why this is a script and not a config line.

Two other measurements ruled out the suspects worth ruling out. The database is not involved: a
first request to `/terms`, which reads nothing, spikes the same ~3 GB, and PGlite's whole
migrate-and-seed footprint is 658 MB standalone. And `experimental.cpus: 1` is not involved either —
removing it changed neither the spike (3.27 GB against 3.16 GB) nor the settled figure.

There is a second, smaller cost sitting next to the first. `next dev` prints `✓ Ready in 407ms` when
it starts listening, which here is about twenty-six seconds before it can serve a page — the first
request pays for Turbopack's compile and PGlite's migrate-and-seed. A session that reads "Ready" and
then watches `curl` hang for twenty-six seconds has every reason to conclude the server is wedged,
and the cheapest thing it can do about that is kill it and start again, which buys another cold
start. The banner is true about listening and misleading about serving, and nothing else says the
difference.

## Decision

`pnpm dev` runs `scripts/dev-server.mjs`, which runs `next dev` as a supervised child.

It derives a memory ceiling from the limit that will actually do the killing — cgroup v2's
`memory.max`, cgroup v1's `memory.limit_in_bytes` (following this process's own path in
`/proc/self/cgroup`), and `os.totalmem()`, whichever is smallest. Reading only `os.totalmem()` is how
a budget ends up above the limit that kills, which is the mistake `'auto'` eviction makes. Both
cgroup generations are read because the two environments this repo runs in disagree: agent
containers put the session in a nested v1 group, a v2 host answers at `memory.max`.

The budget is 60% of that ceiling, or the ceiling less 3 GB, whichever is lower, floored at 1 GB.
The 3 GB is one render's measured transient: a budget that leaves less spare than a single page
render gets the process killed between two polls, which is the failure it was set to prevent.
`DIVEDAY_DEV_MEMORY_BUDGET_MB` overrides it; `0` turns supervision off.

The supervisor samples the tree's RSS every five seconds and restarts the server after three
consecutive samples over budget. Three, not one, because a single render allocates about 3 GB
transiently and returns most of it — measured on a cold `/terms`: 167 MB → 2,996 MB during the
request, settling to 1,400 MB three seconds later. A one-sample trigger would restart on the
ordinary shape of the work rather than on the growth. Fifteen seconds sustained over budget is
something a spike does not survive.

A restart is cheap and is announced in the terms that matter to whoever reads it: what the number
was, what the budget is, that Next's dev server grows without a ceiling, that the filesystem cache
survives so the next page is a warm compile, and that nothing the reader was doing caused it.
Turbopack's cache and `.pglite` both live on disk, so nothing is lost but any request in flight —
which is strictly better than losing the whole server to a kill nobody can see. A restart waits for
the old child to exit before starting the new one, because two processes on one file-backed
`.pglite` diverge silently.

If the kernel gets there first anyway, the supervisor sees the child exit on `SIGKILL`, says so in
as many words, and starts it again. That sentence is the only place that failure is ever named.

After every start it polls `/api/health` — one request that proves the process *and* its database —
and prints one line naming the port it is really on and how long the warm took. That line, not
Next's banner, is when the server can serve. It also moves the first cold compile into startup,
where it is expected, instead of ambushing the first real request.

Two smaller things ride along, both of which the supervision made visible:

- The port Next actually bound is read off its own output, and a drift ("Port 3000 is in use …
  using available port 3001") is called out. A session that keeps reading 3000 gets whatever other
  project owns that port, which reads exactly like a change not taking effect.
- `pnpm dev` now sets `NEXT_PUBLIC_SENTRY_DSN=` the way `pnpm e2e:build` already did. The DSN is
  compiled in (`src/lib/sentry-dsn.ts`), so until now every error raised by half-finished local code
  was reported to the production Sentry project.

## Alternatives considered

**`experimental.turbopackMemoryEviction: 'full'`.** The obvious one-line answer, and it was
measured rather than assumed: 5,266 MB against a 5,339 MB control over the same twenty routes. Not a
fix. Its `'auto'` default cannot help either, for the reason above — there is no system pressure to
detect inside a cgroup whose limit is below the host's memory.

**`NODE_OPTIONS=--max-old-space-size=…`.** Measured and refuted: capped at 1536 MB the process
reached 5.3 GB with no heap OOM. The memory is native.

**Upgrading Next.** 16.3.4 is the latest stable release; there is nothing to upgrade to.

**Removing `experimental.cpus: 1`.** Tested on the suspicion that it forced prerendering in-process.
It changed neither the spike nor the settled figure, and it is read only by `next build` in any case.
Left exactly as it was.

**Letting it crash and documenting the symptom.** A written rule that "if the dev server vanishes,
it ran out of memory" would be read by whoever remembered to go looking for it. The repository has
already learned this one twice — `scripts/guard-bash.mjs` and `scripts/stray-processes.mjs` both
exist because a rule in prose was followed for a while and then wasn't. A crash that explains itself
costs nothing to remember.

**Failing instead of restarting.** Refusing to continue would make the budget unmissable, and would
also mean every session hits a dead server and starts a cold boot by hand. The restart is a second
of downtime against a boot; the announcement is what makes it honest.

## Consequences

- A dev server that would have been OOM-killed is restarted instead, with a line saying so. The
  request in flight at that moment fails.
- `pnpm dev` prints one extra line at startup (the budget) and one when the server can actually
  serve. Everything `next dev` writes is passed through untouched.
- Startup is slower by the warm request — the compile that used to be charged to whoever browsed
  first.
- Local errors stop reaching the production Sentry project. Set `NEXT_PUBLIC_SENTRY_DSN` explicitly
  to get the old behaviour back for a session.
- The supervisor is one more thing between `pnpm dev` and Next. It kills its child on every exit
  path, and `DIVEDAY_DEV_MEMORY_BUDGET_MB=0` reduces it to a passthrough.
- The numbers here are this app on this Next. When either moves enough to matter, re-measure rather
  than trusting the table — `scripts/dev-server.mjs`'s header carries the method.
