# 20260723-concurrency-safe-demo-bootstrap — Serialize and un-poison cold-start seeding

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/archive/codebase-review-20260723.md) (CR-010)
found three related problems in `src/db/client.ts`'s `getDb()`/`init()` and `src/db/seed.ts`'s
`seedIfEmpty()`:

- **No transaction, lock, or conflict-safe insert guards the check-then-seed sequence.** `seedIfEmpty`
  reads "does any shop row exist," then — outside any transaction — runs dozens of plain `INSERT`s
  across `seedDemo`/`seedDemoSchedule`. Two concurrent callers can both pass the empty check and both
  seed a full demo shop; only `shops.slug`'s unique constraint stops a full duplicate, and it does so
  by throwing an unhandled `23505` rather than converging gracefully.
- **This is a real production risk, not just a theoretical one.** Production runs Neon Postgres via
  `drizzle-orm/node-postgres` in Vercel serverless functions
  ([20260718-vercel-neon-hosting](20260718-vercel-neon-hosting.md)). `getDb()`'s promise
  memoization is scoped to `globalThis`, which is per-process — it dedupes concurrent `getDb()` calls
  *within* one function instance, but Vercel can and does spin up multiple concurrent instances for
  concurrent requests (especially at a true cold start right after a deploy, or waking from
  scale-to-zero), each with its own `globalThis` and its own independent race against the same empty
  `shops` table.
- **A failed cold start poisons the process forever.** `globalForDb.divedayDbPromise ??= init()`
  memoizes the *rejected* promise too, and nothing ever clears it — every subsequent `getDb()` call in
  that process returns the same permanently-rejected promise until the process restarts.
- **A partial seed failure isn't repairable.** With no transaction, a network blip partway through
  `seedDemo` leaves whatever inserted so far permanently committed. On retry, `seedIfEmpty`'s "any shop
  exists" check now finds that partial shop and stops — the demo shop exists but is missing courses,
  trips, staff, or whatever came after the failure, with no automatic repair path.

## Decision

- **`seedIfEmpty` now always runs inside the transaction that will hold every row it inserts** — both
  in `init()`'s Postgres branch and its PGlite branch. A failure anywhere in `seedDemo`/
  `seedDemoSchedule` rolls back every row from that attempt, so a retry finds a genuinely empty
  database (matching the pre-seed state) rather than a half-seeded shop the empty-check would treat as
  already done. `seedIfEmpty`'s own function signature is unchanged (`DbExecutor`, so it already
  worked when passed a transaction); only its caller in `init()` changed.
- **A Postgres transaction-scoped advisory lock (`pg_advisory_xact_lock`) serializes concurrent cold
  starts across process boundaries.** Taken as the first statement inside the same transaction that
  then runs `seedIfEmpty`, using a fixed arbitrary key (`SEED_LOCK_KEY`). `pg_advisory_xact_lock`
  blocks until acquired and is automatically released at commit or rollback — including if the holding
  connection/process dies — so a crashed cold start can never leave the lock stuck. A second
  process's `init()` call blocks on the lock, then (once it acquires it) re-runs `seedIfEmpty`'s own
  "any shop exists" check and finds the first process's now-committed shop, correctly no-oping instead
  of seeding a duplicate — the standard double-checked-locking shape.
  - **Postgres-only.** PGlite's branch skips the advisory lock: PGlite is a single embedded
    connection per process, so there's no cross-process race to guard against there, and the
    in-process promise memoization already serializes calls within one process either way. The
    transaction-wrapping (atomicity) still applies to both branches.
- **`getDb()` clears its own memoized promise when `init()` rejects**, via `init().catch((error) => {
  globalForDb.divedayDbPromise = undefined; throw error; })`. The *current* call still sees (and
  reports) the failure; the *next* `getDb()` call gets a fresh `init()` attempt instead of the same
  permanently-rejected promise.
- **A failed Postgres connection pool is closed, not leaked.** If the seeding transaction throws, the
  `pg.Pool` created for that attempt is never handed back to any caller and nothing else will ever
  close it — `init()` now calls `pool.end()` in that failure path before rethrowing, so a run of
  repeated failed cold starts (e.g. Neon briefly unreachable) doesn't accumulate leaked connections.
- **No "missing demo shop" UI fallback was introduced.** The existing behavior — a route that needs the
  demo shop and doesn't find one throws/renders whatever it already did — is unchanged; this ticket is
  about the seeding path being safe to retry, not about tolerating its absence.

## Alternatives considered

- **A dedicated `seed_lock`/`bootstrap` table with an application-level row lock** (`SELECT ... FOR
  UPDATE`) instead of a Postgres advisory lock — would need a real row to exist before the seed that
  creates it has run, an awkward chicken-and-egg the advisory lock avoids entirely (it needs no backing
  row, just a fixed numeric key).
- **A session-scoped advisory lock (`pg_advisory_lock`/`pg_advisory_unlock`)** instead of the
  transaction-scoped variant — requires manually pairing lock/unlock on the *same* connection, which
  `node-postgres`'s `Pool` doesn't guarantee across separate queries (a `Pool` can hand out a different
  pooled connection per statement outside a transaction). The transaction-scoped variant sidesteps this
  entirely: drizzle pins one connection for the duration of `db.transaction(...)`, and Postgres releases
  the lock automatically at commit/rollback regardless of what happens to that connection afterward.
- **Extending `findOrCreatePerson`'s catch-and-reread pattern (CR-008) to the whole seed** — the
  established codebase idiom for "read, then insert, and gracefully converge on a unique-constraint
  loss" — would require scaling that pattern to dozens of tables across `seedDemo`/`seedDemoSchedule`,
  each needing its own conflict-safe reread. The advisory lock is a single, one-line primitive that
  serializes the whole attempt instead, at the cost of a short wait for the losing process rather than
  a graceful reuse — acceptable here because losing means "someone else is seeding the one shared demo
  shop right now," not "a real user's write lost a race," and the loser's wait is bounded by how long
  seeding itself takes.

## Consequences

- `init()`'s Postgres branch now does one extra round trip (`pg_advisory_xact_lock`) before the
  existing "any shop exists" check, only on a genuine cold start — once the shop exists, every
  subsequent `getDb()` call in every process still short-circuits before ever opening this transaction
  (memoized in-process, and even a fresh process's `seedIfEmpty` check returns immediately once the
  shop row is there).
- `createTestDb()` is untouched — it was never seeded and has no memoization, so it's unaffected by
  either the transaction-wrapping or the advisory lock.
- The true multi-process race (two separate Vercel function instances actually colliding) is not
  exercisable by this repo's PGlite-only test harness — the same acknowledged limitation already
  documented elsewhere for `FOR UPDATE`-based concurrency (`src/db/bookings.ts`). What's tested here is
  the mechanism's correctness in isolation (transaction rollback restores an empty database; a repeat
  call after a successful seed is a no-op) and reasoned about, not exercised under real concurrent
  connections.
