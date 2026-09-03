# 20260903-one-process-per-pglite-directory — A file-backed PGlite directory admits one process, and says who has it

- **Status:** Accepted
- **Date:** 2026-09-03
- **Alongside:** 20260903-the-dev-server-is-supervised, which stopped the other half of the same
  afternoon's local-run damage and whose `db:reset` refusal is this rule enforced from the outside.

## Context

PGlite takes no lock on its data directory. Not across processes, not within one.

Two processes that open the same `.pglite` do not error, do not warn, and do not block. They fork
the database: each sees only its own writes, and whichever closes last lands its copy on disk over
the other's. Verified by experiment on 2026-09-03 — two `node` processes, one directory, forty
committed rows inserted by each, both exiting 0 with no output. Process A read back its own forty
plus the seed; process B read back its own forty plus the seed; neither ever observed the other. A
third process reading the directory afterwards found one set.

Nothing in this repository compensated. Two routine local actions reach that state:

- `pnpm build` beside a running `pnpm dev`. Both take the `!DATABASE_URL && PGLITE_DATA_DIR !==
  "memory"` branch of `init()` and open `.pglite`.
- `pnpm db:reset` under a live dev server, which deletes the directory the server still holds open
  — the server keeps answering from its handles and discards every later write on exit. That half
  was fixed on the same day by `scripts/db-reset.mjs` refusing while a server is live.

What makes this worth a mechanism rather than a rule is the shape of the failure: it is entirely
silent, and it surfaces hours later as "my change didn't save". A rule in prose was written for it
first, in AGENTS.md's `db:reset` row and the debug skill, and prose was the wrong instrument —
this repository already has `scripts/guard-bash.mjs` and `scripts/stray-processes.mjs` because a
written rule was followed for a while and then wasn't.

The reason it had not been fixed already was blast radius, and the fear turned out to be
misplaced. Two measurements settled it:

- **The e2e and visual fleets never touch a file-backed directory.** `playwright.config.ts` sets
  `PGLITE_DATA_DIR: "memory"` unconditionally in the `serverEnv` every worker server inherits, and
  `pnpm e2e:build` sets it for the build behind them. In-memory gives every process its own
  database, which is the isolation the parallel fleet is built on. A file-backed lock cannot reach
  them.
- **A local `pnpm build` opens the directory from one process at a time.** Measured by polling
  `/proc/*/fd` across a full build: **maximum one** concurrent holder, and Next's own output agrees
  — `Generating static pages using 1 worker`, which is what `experimental.cpus: 1` and
  `staticGenerationMaxConcurrency: 1` are set for (`next.config.ts`).

So a process-lifetime lock costs nothing that anybody runs, and the only thing it changes is that
the silent fork becomes a refusal.

## Decision

The file-backed branch of `init()` takes an exclusive lock on the data directory before
constructing the `PGlite` client — before, because after it there is already a second copy of the
database in memory. `src/db/data-dir-lock.ts` holds the mechanism.

The lock is `<dataDir>/.diveday-lock`, written with the `wx` flag and holding `{ pid, since }`. A
second opener is refused with a message naming the pid to stop and the `PGLITE_DATA_DIR` escape.

**`since` is what makes the refusal safe to ship.** This app's dev server is usually *killed*
rather than stopped — that is the entire subject of the ADR alongside this one — so a lock
outliving its holder is the normal end state, not the exotic one. Liveness alone would therefore
refuse every future start once a pid was recycled, which is a worse failure than the one being
fixed. `since` is the holder's process start time from `/proc/<pid>/stat` field 22, so a recycled
pid is distinguishable from the original holder rather than guessed at. It is read from the last
`)` in the line rather than by splitting it, because `comm` can contain spaces and parentheses and
`next-server (v16.3.4)` does; the offset was verified against `/proc/uptime` rather than counted
off the man page.

Where the answer cannot be known — no token recorded (written off Linux), or none readable now —
the holder is treated as **live**. The two mistakes are not symmetric: treating a live holder as
stale resumes the silent data loss, while treating a dead one as live refuses to start, which is
loud and recoverable.

The release removes the file only if it still names this process, so a lock taken over as stale
and since taken again by a third process is never deleted out from under its new owner. It is
registered on `process.on("exit")`, and also runs when `init()` throws.

`init()` now also closes the PGlite client when it throws. `getDb()` clears its memo on rejection
so the next request builds another one; without this, a database that fails to migrate stacked a
fresh ~170 MB instance — and an undroppable lock — on every retry, for as long as anything kept
asking.

### What this does not cover

Openers that come through `init()`, which is every way this app reaches its own database. It
cannot guard a tool that opens the directory itself: `drizzle.config.ts` points
`dbCredentials.url` at `./.pglite`, so `drizzle-kit studio` or `push` would still fork it.
`pnpm db:generate` diffs the schema and never connects, and `pnpm db:migrate` runs against the
production config, so neither is exposed today. Stated rather than papered over.

## Alternatives considered

**A real `flock`.** The correct primitive, and it would survive a kill with no staleness logic at
all. Node has no `flock` in core, so it means a native dependency, which means an ADR for the
dependency and a compiled module in a repo that currently needs no compiler to install. Not worth
it for a guard whose subject is one directory on one developer's machine.

**Liveness alone, no start token.** Simpler, and wrong here for the reason above: this server dies
by SIGKILL, so stale locks are routine and pid recycling would eventually wedge local development
entirely.

**Leaving it as prose.** It was prose for a day. The failure is silent, and the repository's own
history is that a rule which can be checked mechanically eventually has to be.

**Giving `pnpm build` its own data directory** (`PGLITE_DATA_DIR=.pglite-build`). Removes the
collision without detecting anything, and the measurement says the collision is not the build's
fault — one worker, one opener. It would also hide the next opener rather than name it, and say
nothing about `db:reset` or a second dev server.

## Consequences

- A second opener of one `.pglite` fails immediately with a message naming the process holding it,
  where it used to succeed and lose writes.
- A lock left by a killed server is taken over silently on the next start. Verified: SIGKILL the
  whole dev tree, then open the database again — it takes over. `pnpm build` leaves one behind
  every time (Next kills its static-generation worker, so no exit handler runs), and the following
  `pnpm dev` takes it over without a word. That sequence was measured end to end.
- Nothing changes for `PGLITE_DATA_DIR=memory`: no lock is taken, and the e2e and visual fleets are
  untouched. A focused `pnpm e2e e2e/booking.spec.ts` passes (8 tests).
- A failed cold start now closes its client instead of pinning ~170 MB per attempt.
- One more file appears in `.pglite/`. It is inside a gitignored directory and `pnpm db:reset`
  removes it with everything else.
