import { and, eq, sql } from "drizzle-orm";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import { refreshCanonicalDemoSchedule } from "./demo-refresh";
import { DEMO_SHOP_SLUG } from "./dev-credentials";
import { shops } from "./schema";

// The demo bootstrap `getDb()` runs on a database's first open: the seeded demo
// shop, and the local playground's schedule refresh. Apart from `client.ts`
// because the seed graph reaches most of `src/db`, and those modules import
// query helpers; with this in `client.ts` the module that owns boot order sat
// in a 32-file import cycle (`src/db/import-cycles.test.ts`). `client.ts`
// still decides *when* this runs (ADR 20260723-concurrency-safe-demo-bootstrap,
// ADR 20260903-one-process-per-pglite-directory); this file is *what* runs.

/**
 * Arbitrary fixed key for the demo-seed advisory lock (CR-010) — any int8
 * works; it only has to be stable and not collide with another lock this app
 * might one day take. Picked by typing on the keyboard, not derived from
 * anything meaningful.
 */
const SEED_LOCK_KEY = 872_363_841;

/**
 * Cheap "already seeded" marker: a single indexed-lookup `SELECT`, no
 * transaction, no lock. `seedDemo`'s one transaction either inserts this row
 * or never runs at all, and it is never reaped (see `reapExpiredDemoShops`
 * in seed.ts, which excludes `DEMO_SHOP_SLUG`), so once this is true it stays
 * true for the life of the database — the fast path below trusts it
 * unconditionally instead of re-deriving it from scratch.
 */
export async function isDemoShopSeeded(db: DbExecutor): Promise<boolean> {
  const [existing] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true)))
    .limit(1);
  return Boolean(existing);
}

/**
 * Cold-start seed/backfill fast path (audit: docs/product/archive/
 * specialist-optimization-audit-20260731.md §7 "Trim production cold-start
 * work"). Every cold start used to unconditionally open a transaction, take
 * a cross-process advisory lock, and run three scans of seed.ts's checks —
 * on a long-lived, already-seeded database (the overwhelmingly common case
 * once the demo shop exists) that work is pure waste repeated on every new
 * serverless instance. `isDemoShopSeeded` short-circuits all of it with one
 * cheap `SELECT`; only a genuinely fresh database falls through to the slow,
 * locked, three-function path. `lock` is optional because the PGlite branch has
 * nothing to take one *on* — an advisory lock is held by a database, and two
 * openers of one data directory do not share one (see `init`).
 */
export async function seedProductionDb(
  db: AppDb,
  opts: { lock?: (tx: AppTransaction) => Promise<void> } = {},
): Promise<void> {
  if (await isDemoShopSeeded(db)) return;
  await db.transaction(async (tx) => {
    // Serializes concurrent cold starts across separate serverless
    // instances/processes racing to seed the same fresh database — the
    // in-process promise memoization above can dedupe concurrent calls
    // within one process, but a genuinely separate process (a second
    // Vercel function instance handling a concurrent request) has its
    // own `globalThis` and never sees it. A transaction-scoped Postgres
    // advisory lock reaches across that boundary and is automatically
    // released at commit/rollback — including if the process crashes —
    // so a dead process can never leave it stuck (CR-010).
    await opts.lock?.(tx);
    // Also makes the whole seed atomic: everything seedIfEmpty inserts
    // now runs inside this one transaction, so a failure partway
    // through rolls back every row instead of leaving a half-seeded
    // shop a retry would find already-non-empty and stop repairing.
    // Imported here rather than at module scope, and this is not style. The
    // seed reaches `./schema` (360 KB), `./course-templates` (186 KB) and
    // `./dive-site-templates`, and `client.ts` is imported by every route that
    // touches the database — so a static edge here put that whole subgraph in
    // the module closure of 122 of this app's 127 route entries, including
    // every marketing page and API handler that never seeds anything.
    // Deferring it takes that to 16. In `next dev` Turbopack keeps each
    // entrypoint's modules in memory with no eviction, so the shared graph is
    // what the per-route growth is made of.
    const { seedIfEmpty } = await import("./seed");
    await seedIfEmpty(tx);
  });
}

/**
 * Keep the persisted local playground current without ever touching a real
 * database. Production gets this pass from `/api/cron/demo-refresh`; a local
 * PGlite database has no cron, so the natural equivalent is the next dev boot.
 * The explicit URL guard stays here as well as at the call site so a future
 * caller cannot accidentally run the demo keeper against a configured pool.
 */
export async function refreshPgliteDemo(db: AppDb, databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return;
  await refreshCanonicalDemoSchedule(db);
}

/**
 * Take the cross-process seed lock inside the seeding transaction — the
 * Postgres branch's `lock` for {@link seedProductionDb}. Transaction-scoped, so
 * it is released at commit or rollback, including when the process dies.
 */
export async function takeSeedLock(tx: AppTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
}
