---
name: run
description: Start, wait for, or stop the local dev server, look at a change in the real app, or find why it died or answers on the wrong port.
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

## Look at a change

```bash
node scripts/screenshot.mjs /s/blue-mantis /shop/blue-mantis --as owner
```

Light × phone and desktop, into `screenshots/` (gitignored); add `--both` for dark as well, which
only colour work needs. `/shop/**` signs itself in through the seeded dev credentials. It needs a
server already running and does not start one.

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

## When it misbehaves

- [supervisor.md](supervisor.md) — what each `dev:` line from `scripts/dev-server.mjs` means and what to do about it.
- [pitfalls.md](pitfalls.md) — the known traps: one server per checkout, one process on `.pglite`, a seed edit needs `pnpm db:reset`, `pnpm e2e` builds first, stop the server before type-checking, `.next` growth.
