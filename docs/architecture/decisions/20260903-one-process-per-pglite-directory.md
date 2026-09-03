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

**The claim is the filename, and no process ever writes to another's.** Each opener creates
`<dataDir>/.diveday-lock.<pid>.<since>` and *then* reads the directory: if any other entry names a
process still running, it deletes its own claim and refuses with a message naming the pid to stop
and the `PGLITE_DATA_DIR` escape.

That order is the whole argument. Whichever opener creates its file second is guaranteed to see the
first — its read happens after its own write, which happened after the other's — so it is the
one that refuses. Two openers whose writes both land before either read see each other and *both*
refuse, which is safe (the database stays shut) and honest (each names the other). What cannot
happen is both proceeding, and that is the only outcome that loses data.

A single lock file cannot make that claim, and the first draft of this ADR shipped one that
couldn't: read the lock, find the holder dead, overwrite it. Two starters after a killed server
both read the same dead owner, both conclude "stale", and both write — arriving at the silent fork
*through* the guard. Every repair keeps the shape: rename-then-create hands the loser a window to
delete the winner's fresh lock, and a take-token needs its own staleness rule, one turtle down. The
hole is that POSIX has no compare-and-swap on a file, so any scheme that *replaces* a shared file
has a read-modify-write window in it. Per-process filenames have nothing to replace.

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

A claim whose process is *gone* is swept up on sight by the next opener, and that sweep is safe to
race: the filename says whose claim it is, so two processes removing the same dead one both do
exactly the intended thing. A claim naming the reader's own pid is ignored — a second opener
inside one process is not what this guards, and refusing one would mean refusing the database
this process claimed against itself, permanently, since the holder is alive by definition.

The release removes this process's own claim, the only file it ever wrote. It is registered on
`process.on("exit")`, and also runs when `openLocalDb()` throws.

`init()`'s file-backed half is now `openLocalDb()`, exported with its migrate step injectable so
the failure path can be reached from a test at all. It closes the PGlite client when it throws, and
the client is constructed *inside* that cleanup, so a constructor that fails still drops the claim.
`getDb()` clears its memo on rejection so the next request builds another one; without this, a
database that fails to migrate stacked a fresh ~170 MB instance — and a claim file naming a live
process — on every retry, for as long as anything kept asking.

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
by SIGKILL, so abandoned claims are routine and pid recycling would eventually wedge local
development entirely.

**One lock file, taken over when its holder is dead.** What this ADR shipped first, and what a
review found the race in; the Decision above has the argument. Kept here because it is the obvious
design and the next person will reach for it.

**Leaving it as prose.** It was prose for a day. The failure is silent, and the repository's own
history is that a rule which can be checked mechanically eventually has to be.

**Giving `pnpm build` its own data directory** (`PGLITE_DATA_DIR=.pglite-build`). Removes the
collision without detecting anything, and the measurement says the collision is not the build's
fault — one worker, one opener. It would also hide the next opener rather than name it, and say
nothing about `db:reset` or a second dev server.

## Consequences

- A second opener of one `.pglite` fails immediately with a message naming the process holding it,
  where it used to succeed and lose writes.
- A claim left by a killed server is swept up silently on the next start. Verified: SIGKILL the
  whole dev tree, then open the database again — it starts. `pnpm build` leaves one behind every
  time (Next kills its static-generation worker, so no exit handler runs), and the following
  `pnpm dev` sweeps it up without a word. That sequence was measured end to end.
- Two openers racing from a cold directory can now both refuse rather than one silently forking.
  Loud and recoverable, and it takes microsecond-scale simultaneity to reach.
- Nothing changes for `PGLITE_DATA_DIR=memory`: no lock is taken, and the e2e and visual fleets are
  untouched. A focused `pnpm e2e e2e/booking.spec.ts` passes (8 tests).
- A failed cold start now closes its client instead of pinning ~170 MB per attempt.
- One more file appears in `.pglite/` per live opener. They are inside a gitignored directory,
  `pnpm db:reset` removes them with everything else, and an abandoned one is swept up by the next
  start — so there is never anything to delete by hand.
