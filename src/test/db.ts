import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, onTestFinished } from "vitest";
import { type AppDb, createTestDb } from "@/db/client";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { type TemplateVariant, templateBytes } from "./db-template";

/**
 * Close the test's PGlite when the test finishes.
 *
 * Every `seededTestDb()` call spins up a fresh embedded Postgres, and each one
 * pins ~250MB of resident memory. Left open, a single file's worth of tests
 * (~20) leaks multiple gigabytes into its Vitest worker, and the resulting GC
 * pressure drags every subsequent hydration from ~0.5s toward multiple seconds
 * — a cost that compounds as the suite grows. Releasing the instance the
 * moment the test that owns it ends keeps a worker's memory flat and its
 * hydrations warm. `onTestFinished` runs after both the test body and its
 * assertions, so the database stays live for the whole test.
 */
function closeWhenTestFinishes(client: PGlite): void {
  onTestFinished(async () => {
    await client.close();
  });
}

/**
 * Migrated but *unseeded* in-memory PGlite database, closed when the owning
 * test finishes.
 *
 * Prefer this over importing `createTestDb` from `@/db/client` directly: that
 * factory has no lifecycle hook, so a test using it pins its ~250MB embedded
 * Postgres for the rest of the worker's life. See {@link closeWhenTestFinishes}.
 */
export async function unseededTestDb(): Promise<AppDb> {
  const db = await createTestDb();
  closeWhenTestFinishes(db.$client as PGlite);
  return db;
}

// The snapshot is tens of megabytes and hydration wraps it in a Blob every
// time. PGlite only reads the Blob (via `.arrayBuffer()`), never consumes it,
// so one Blob per worker per variant serves every hydration — rebuilding it per
// call cost ~57ms each across ~900 db-backed tests. Same globalThis-keyed
// per-worker caching as the bytes themselves (db-template.ts).
const globalForBlob = globalThis as typeof globalThis & {
  divedayTestDbBlob?: Partial<Record<TemplateVariant, Blob>>;
};

function templateBlob(variant: TemplateVariant, bytes: Uint8Array<ArrayBuffer>): Blob {
  globalForBlob.divedayTestDbBlob ??= {};
  const cache = globalForBlob.divedayTestDbBlob;
  const cached = cache[variant];
  if (cached) return cached;
  const blob = new Blob([bytes], { type: "application/x-tar" });
  cache[variant] = blob;
  return blob;
}

/**
 * Say it, once per worker per variant.
 *
 * This fallback costs `initdb + migrate + seed` — about **8.5 seconds per
 * test** against a hydration's ~0.7s (db-template.ts) — and until now it said
 * nothing at all. A file that quietly takes that path does not fail; it runs
 * twelve times slower, and the first thing anyone sees is a test tripping
 * Vitest's 20-second ceiling with no clue why, on a run that was fine
 * yesterday. Both known causes (a foreign config that skips global setup, and a
 * snapshot a parallel invocation is rewriting) are one line of explanation
 * away, and neither is guessable from a timeout.
 *
 * Once per worker per variant, not per test: a warning printed ~900 times is
 * scrolled past like the silence it replaced.
 */
const globalForWarning = globalThis as typeof globalThis & {
  divedayTestDbWarned?: Set<TemplateVariant>;
};

function warnAboutFullPrice(variant: TemplateVariant): void {
  globalForWarning.divedayTestDbWarned ??= new Set();
  if (globalForWarning.divedayTestDbWarned.has(variant)) return;
  globalForWarning.divedayTestDbWarned.add(variant);
  console.warn(
    `seededTestDb: no usable "${variant}" template snapshot — seeding each test from scratch ` +
      "(~8.5s per test instead of ~0.7s). Expect timeouts. Either Vitest's global setup did not " +
      "run (a foreign config or a direct runner), or the snapshot under " +
      "node_modules/.cache/diveday is missing, empty, or being rewritten by a parallel run. " +
      "See src/test/db-template.ts.",
  );
}

/**
 * Fresh in-memory PGlite database seeded with the demo dataset. Each call
 * hydrates its own isolated database from the snapshot built by the Vitest
 * global setup (see db-template.ts) — do not cache or share a single instance
 * across tests. `{ history: true }` hydrates from the second snapshot, the one
 * carrying seed.ts's trailing-quarter back-fill. The instance is closed
 * automatically when the owning test finishes.
 */
export async function seededTestDb(options: { history?: boolean } = {}): Promise<AppDb> {
  const variant: TemplateVariant = options.history ? "history" : "lean";
  const bytes = await templateBytes(variant);
  if (!bytes) {
    // Global setup didn't run (foreign config / direct runner), or the snapshot
    // was unreadable: pay full price, building the same dataset the missing
    // snapshot would have held.
    warnAboutFullPrice(variant);
    const db = await createTestDb();
    await seedDemo(db, { history: variant === "history" });
    closeWhenTestFinishes(db.$client as PGlite);
    return db;
  }
  const client = new PGlite({
    loadDataDir: templateBlob(variant, bytes),
    extensions: { pg_trgm, btree_gist },
  });
  closeWhenTestFinishes(client);
  return drizzle({ client });
}

/** As {@link seededTestDb}, plus the seeded "blue-mantis" demo shop row. */
export async function seededShopContext(options: { history?: boolean } = {}) {
  const db = await seededTestDb(options);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  return { db, shop };
}

/**
 * Thrown to roll a test's transaction back. A sentinel rather than a plain
 * `Error` so the catch below can tell "the test is over, undo it" from a real
 * failure inside the transaction, which must still surface.
 */
const ROLLBACK = Symbol("diveday:rollback");

/**
 * One PGlite per **file**, and one transaction per test that is rolled back
 * afterwards.
 *
 * `seededShopContext()` hydrates a fresh database per test at ~0.6-0.9s each,
 * and that hydration is most of the unit suite's wall-clock: measured on
 * 2026-09-01, the 38 database-backed files under `src/db` accounted for 849 of
 * 988 test-seconds. The template already made this ten times cheaper than
 * migrating per test; what is left is structural, and the only way past it is
 * to stop hydrating per test.
 *
 * Isolation is preserved by the transaction, not by the database: each test
 * gets an `AppDb` that is really a transaction handle, and every row it writes
 * is undone before the next test starts. Query code needs no change — the
 * handle is the same type.
 *
 * ## When NOT to use this
 *
 * The rollback is the whole mechanism, so anything that needs a *committed*
 * database, or its own transaction semantics, must stay on
 * {@link seededShopContext}:
 *
 * - **A test that opens its own transaction** gets a savepoint instead of a
 *   top-level one. Usually equivalent, and not always — which is why the
 *   money-path files were written against a fresh database on purpose.
 * - **`FOR UPDATE` and the concurrency races.** Two statements inside one
 *   transaction cannot contend with each other, so a race test would pass
 *   without proving anything, which is worse than failing.
 * - **A test that asserts on `now()`-stamped columns.** Postgres freezes
 *   `now()` at the start of a transaction, so every `defaultNow()` row a test
 *   writes carries the same instant. `dbNow()` reads that same frozen clock,
 *   so a test using it stays consistent — but one comparing two writes
 *   *expecting* them to differ will not see a difference.
 *
 * The rule, short: **read-heavy files that commit nothing.** If a file's tests
 * only read the seeded fixture and write rows they then read back, this is
 * safe; if the file's subject is transactions, money, or concurrency, it is
 * not, and the file says so in a comment where it declines.
 */
export function fileScopedShopContext(options: { history?: boolean } = {}) {
  let base: AppDb | undefined;
  let shop: Awaited<ReturnType<typeof getShopBySlug>>;
  /** The handle the tests read. Reassigned per test to the live transaction. */
  const handle: { db: AppDb } = { db: undefined as unknown as AppDb };
  let finish: (() => void) | undefined;
  let settled: Promise<void> | undefined;

  beforeAll(async () => {
    base = await seededTestDbWithoutTeardown(options);
    shop = await getShopBySlug(base, "blue-mantis");
    if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  });

  afterAll(async () => {
    await (base?.$client as PGlite | undefined)?.close();
    base = undefined;
  });

  beforeEach(async () => {
    const db = base;
    if (!db) throw new Error("fileScopedShopContext: beforeAll did not run");
    // `db.transaction` is callback-scoped, so the transaction is held open by
    // parking the callback on a promise the teardown resolves. Nothing else
    // touches this PGlite in the meantime — it is a single connection owned by
    // one test file — so parking it blocks no other work.
    let ready: () => void = () => {};
    const opened = new Promise<void>((resolve) => {
      ready = resolve;
    });
    settled = db
      .transaction(async (tx) => {
        handle.db = tx as unknown as AppDb;
        ready();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        // Every write this test made goes away with it.
        throw ROLLBACK;
      })
      .catch((error) => {
        if (error !== ROLLBACK) throw error;
      });
    await opened;
  });

  afterEach(async () => {
    finish?.();
    finish = undefined;
    // Await the rollback before the next test opens its own: overlapping them
    // would put two top-level transactions on one connection.
    await settled;
    settled = undefined;
    handle.db = undefined as unknown as AppDb;
  });

  return {
    /** The current test's transaction, typed as the app's own database. */
    get db(): AppDb {
      if (!handle.db) throw new Error("fileScopedShopContext: read outside a test");
      return handle.db;
    },
    /** The seeded demo shop. Read once per file; it is never written. */
    get shop(): NonNullable<Awaited<ReturnType<typeof getShopBySlug>>> {
      if (!shop) throw new Error("fileScopedShopContext: read outside a test");
      return shop;
    },
  };
}

/**
 * {@link seededTestDb} without the per-test close. Only
 * {@link fileScopedShopContext} uses it: its database outlives every test in
 * the file and is closed in `afterAll` instead, and calling `onTestFinished`
 * from `beforeAll` would either throw or close it after the first test.
 */
async function seededTestDbWithoutTeardown(options: { history?: boolean } = {}): Promise<AppDb> {
  const variant: TemplateVariant = options.history ? "history" : "lean";
  const bytes = await templateBytes(variant);
  if (!bytes) {
    warnAboutFullPrice(variant);
    const db = await createTestDb();
    await seedDemo(db, { history: variant === "history" });
    return db;
  }
  return drizzle({
    client: new PGlite({
      loadDataDir: templateBlob(variant, bytes),
      extensions: { pg_trgm, btree_gist },
    }),
  });
}

/**
 * "Now" as *Postgres* sees it.
 *
 * Columns declared `defaultNow()` are stamped by the database's own clock,
 * which `DIVEDAY_CLOCK` does not reach — `src/lib/clock.ts` only freezes the
 * application. So a test that bounds one of those columns ("has this row sat
 * unresolved long enough to count as stuck?") cannot express the bound with
 * `nowMs()`: that compares a frozen instant against a live one, and the row is
 * selected only while the two happen to fall in the right order. It works
 * today because the frozen instant is behind the wall clock, and inverts the
 * day it isn't.
 *
 * Ask the database instead. `dbNow(db) ± window` is the same sentence the test
 * always meant, measured against the clock that actually wrote the column.
 */
export async function dbNow(db: AppDb): Promise<Date> {
  const result = await db.execute<{ now: Date | string }>(sql`select now() as now`);
  const rows = (Array.isArray(result) ? result : (result.rows ?? [])) as {
    now: Date | string;
  }[];
  const value = rows[0]?.now;
  if (!value) throw new Error("dbNow: database returned no now()");
  return value instanceof Date ? value : new Date(value);
}

/** {@link dbNow} shifted by `offsetMs` — the shape these bounds are always written in. */
export async function dbNowPlus(db: AppDb, offsetMs: number): Promise<Date> {
  return new Date((await dbNow(db)).getTime() + offsetMs);
}
