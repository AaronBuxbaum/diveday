# 20260903-the-dev-server-is-supervised — `pnpm dev` runs under a memory budget and says when it can serve

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

`next dev` in this app has no steady-state memory footprint. It grows with every route it serves
and gives back only part of it. There *is* a ceiling — Next never unloads a page's modules once
it has served them, so the footprint converges when every route has been requested — but on this
checkout that ceiling sits above the container, which costs the same as not having one. Measured on 2026-09-03 against Next
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

**It converges, and "unbounded" was the wrong word for it.** Next's own memory guide, shipped with
the installed 16.3.4 at `node_modules/next/dist/docs/01-app/02-guides/memory-usage.md:169`, says the
server preloads each page's modules and "doesn't unload these JavaScript modules, meaning that even
with this optimization disabled, the memory footprint of your Next.js server will eventually be the
same if all pages are eventually requested." So the climb has a ceiling — the whole route graph —
and the problem is that this checkout's ceiling is above the box, not that there is none. That layer
is also not the one `turbopackMemoryEviction` governs, which is the other half of why `'full'` was a
no-op: it evicts Turbopack's *persisted compiler cache*, and the page modules are the *Node server's*.
Two retention layers, one knob, and the knob is on the other one.

For scale, the only vendor figures for this version line: Vercel reports nextjs.org at 840 MB and the
vercel.com dashboard at 2 GB after compiling **fifty** routes
([next-16-3-turbopack](https://nextjs.org/blog/next-16-3-turbopack)). This checkout reaches 5,027 MB
at twenty. That post never states whether its numbers are RSS, V8 heap or total allocation, and ours
are RSS, so the ratio is suggestive rather than rigorous — but it is the only published comparison
that exists, and the gap is wide enough to be worth writing down.

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

There are **two** thresholds, because there are two different situations and one number served
neither.

The **budget** — 60% of the ceiling, or the ceiling less 3 GB, whichever is lower, floored at 1 GB —
means "this server has grown past where it should sit". Nothing is on fire, so a restart there waits
until the server has been idle for four seconds, which costs nobody anything. Idle is read off
Next's own per-request log line; there is no other in-flight signal.

The **hard limit** — 80% of the ceiling — means "the kernel is about to take it", and it interrupts
whatever is running, saying whether anything actually was.

The gap between them is not theoretical, and getting it wrong was the first version of this ADR.
Capturing two staff pages through `scripts/screenshot.mjs` — light and dark, phone and desktop, the
ordinary matrix a session runs to look at its own work — was measured peaking at **12,880 MB**, and
with no supervision at all it OOM-killed the server mid-run. A single-threshold supervisor set
anywhere below that restarts underneath the browser on ordinary work; one set above it never fires
in time. So: hold through the spike, and cut in before the kill. Under the two thresholds that same
capture run completes, having gone 1.5 GB over budget without being touched.

Sampling is every two seconds, and a soft restart needs two consecutive over-budget samples — the
second only to survive a bad `ps` read, since the idle gate is what keeps a spike from triggering
anything. Two seconds rather than five because this server climbed 1.6 GB between two five-second
samples *while idle* (`cacheComponents` re-renders in the background after every settled render);
at that rate a slow poll hands every restart to the hard limit, which is the one that costs somebody
a request.

A transient spike is left alone, which is the common case and was verified: a cold `/` took the
server to 5,886 MB and back to 1,490 MB within three seconds, and nothing restarted.

**A budget that cannot be met is abandoned rather than pursued.** Three budget restarts inside a
minute of each other means the line is below what this app needs at rest, and no restart can meet
it: the server comes back, settles above the line, and is restarted again. Measured with a
deliberately low 1,100 MB budget — twenty-three restarts in thirty seconds, each costing a warm-up.
That is not a contrived setting either: on a 4 GB machine the *derived* budget is the 1 GB floor
while this server settles nearer 1.5 GB, so the default would have thrashed on exactly the machines
least able to afford it. The supervisor now says so once, in those terms, and leaves the server
running unwatched. Futility is judged on the interval between restarts, not on whether memory ever
dipped below the line — it always dips, because a restarted server boots at about 150 MB, and
reading that as relief made the first version of the check never fire.

A restart is announced in the terms that matter to whoever reads it: what the number was, what the
budget is, that Next's dev server never unloads a route it has served, that the filesystem cache
survives so the
next page is a warm compile, and that nothing the reader was doing caused it. Turbopack's cache and
`.pglite` both live on disk, so nothing is lost but any request in flight — which is strictly better
than losing the whole server to a kill nobody can see. A restart waits for the old child to exit
before starting the new one, because two processes on one file-backed `.pglite` diverge silently.

`DIVEDAY_DEV_MEMORY_BUDGET_MB` overrides the budget; `0` turns supervision off.

`scripts/screenshot.mjs` takes the other half of that trade. It now retries a capture once when the
connection drops mid-run — bounded, and only for a dropped connection, so a genuinely broken page
still fails the first time and loudly. Its reachability probe grew a timeout in the same pass:
without one it inherits Node's, and against a server that accepts connections but never answers it
was measured sitting for **301 seconds** before printing "Nothing answering", which is the one
explanation that is false. That is the unbounded wait AGENTS.md has a hard rule against, sitting in
the tool the same file points sessions at.

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
