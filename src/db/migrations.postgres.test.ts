import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import {
  applyMigrations,
  describePostgres,
  type PostgresTestDatabase,
  postgresTestDb,
} from "@/test/postgres";
// Reached by relative path, not by package name: this is a repo-local script,
// and the same module is what `.github/workflows/ci.yml` and the CLI entry point
// use, so the extraction the test rehearses is the extraction CI performs.
import { extractPreviousReleaseMigrations } from "../../scripts/previous-release-migrations.mjs";

/**
 * Do the committed `drizzle/` migrations actually apply to a real Postgres
 * server — and do they still apply when the server already carries the previous
 * release's schema?
 *
 * Until this file existed the answer was "production finds out". `pnpm db:migrate`
 * runs inside the Vercel build step against Neon, nothing rehearses it, and the
 * unit suite's PGlite is a different engine reached a different way
 * (docs/engineering/deploy-and-migrations-runbook.md, "What this runbook does
 * not cover"). Two distinct claims are checked here, and the second is the one
 * that matters:
 *
 *  1. **From empty.** Every migration in `drizzle/` applies to a virgin
 *     database. This catches SQL that PGlite tolerates and Postgres does not —
 *     most concretely `CREATE EXTENSION pg_trgm`, which exists in `drizzle/` as
 *     a real statement but is satisfied in PGlite by a wasm extension loaded in
 *     JavaScript before the migration ever runs (src/db/client.ts).
 *
 *  2. **From the previous release.** The migrations reachable from this
 *     branch's fork point are applied first, then today's set on top — which is
 *     what a production deploy does, and the only shape in which a *contracting*
 *     migration can fail. From empty there is nothing to drop, rename, or
 *     tighten, so a `DROP COLUMN` that breaks the running deployment applies
 *     perfectly cleanly. The expand/contract rule this repo deploys under is a
 *     rule about exactly this path.
 *
 * The second test then asserts the two databases have the **same schema**. A
 * migration that applies cleanly on both paths but leaves them structurally
 * different means the upgrade path and the fresh-install path have diverged —
 * a shop provisioned tomorrow would be running a different schema from a shop
 * that upgraded into it, and nothing else in the repo would notice.
 */

/**
 * A comparable fingerprint of what the database actually looks like: every
 * column of every table in `public`, plus the constraints and indexes over
 * them.
 *
 * Read from the catalog rather than compared against `src/db/schema.ts`,
 * deliberately — the point is what the *migrations* produced, and a comparison
 * against the TypeScript schema would answer drizzle's question ("is my model
 * in sync?") instead of the deploy's ("did the upgrade path land where the
 * fresh install did?").
 */
async function schemaFingerprint(db: PostgresTestDatabase["db"]): Promise<string[]> {
  const columns = await db.execute(sql`
    select table_name, column_name, data_type, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, column_name
  `);
  const constraints = await db.execute(sql`
    select conrelid::regclass::text as rel, conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where connamespace = 'public'::regnamespace
     order by rel, conname
  `);
  const indexes = await db.execute(sql`
    select tablename, indexname, indexdef
      from pg_indexes
     where schemaname = 'public'
     order by tablename, indexname
  `);
  const rows = (result: unknown): Record<string, unknown>[] => {
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    const inner = (result as { rows?: unknown }).rows;
    return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : [];
  };
  return [...rows(columns), ...rows(constraints), ...rows(indexes)].map((row) =>
    JSON.stringify(row),
  );
}

/** Table names the app owns, per `src/db/schema.ts` — not drizzle's own bookkeeping. */
async function appTableCount(db: PostgresTestDatabase["db"]): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as tables
      from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  const list = (Array.isArray(result) ? result : ((result as { rows?: unknown }).rows ?? [])) as {
    tables: number;
  }[];
  return list[0]?.tables ?? 0;
}

describePostgres("drizzle migrations against a real Postgres server", () => {
  it("applies every migration to an empty database", async () => {
    // `{ migrations: false }` because applying them *is* the assertion — the
    // helper's own migrate step would swallow the failure this test exists for.
    const pg = await postgresTestDb({ migrations: false });

    await expect(applyMigrations(pg.db, "drizzle")).resolves.not.toThrow();

    // A green migrate against a database where nothing ran would be the quiet
    // failure here, so assert the result is a populated schema and that the
    // trigram extension the search indexes need is genuinely installed — the
    // one thing PGlite satisfies out-of-band and a bare Postgres container does
    // not (see the header).
    expect(await appTableCount(pg.db)).toBeGreaterThan(30);
    const extensions = await pg.db.execute(sql`select extname from pg_extension`);
    const names = (
      Array.isArray(extensions) ? extensions : ((extensions as { rows?: unknown }).rows ?? [])
    ) as { extname: string }[];
    expect(names.map((row) => row.extname)).toContain("pg_trgm");
  });

  it("applies today's migrations on top of the previous release's schema, landing on the same schema", async () => {
    const previousDir = mkdtempSync(path.join(tmpdir(), "diveday-prev-migrations-"));
    onTestFinished(() => rmSync(previousDir, { recursive: true, force: true }));
    const previous = extractPreviousReleaseMigrations(previousDir);
    // Not a skip. A clone too shallow to name a base commit is a CI
    // configuration problem, and skipping would turn this file into a test that
    // silently stopped checking the only path production actually takes. The
    // real-postgres job checks out with `fetch-depth: 0` for this reason.
    if (!previous.ok) throw new Error(`previous release unresolved: ${previous.reason}`);
    expect(previous.migrations).toBeGreaterThan(0);

    const upgraded = await postgresTestDb({ migrations: false });
    await applyMigrations(upgraded.db, previousDir);
    // The deploy's own step: only the migrations this branch adds run here,
    // against a database that already holds every older one.
    await expect(applyMigrations(upgraded.db, "drizzle")).resolves.not.toThrow();

    const fresh = await postgresTestDb();
    const upgradedSchema = await schemaFingerprint(upgraded.db);
    // Two empty fingerprints compare equal, which would make the assertion
    // below pass against a database where nothing ran at all.
    expect(upgradedSchema.length).toBeGreaterThan(100);
    expect(upgradedSchema).toEqual(await schemaFingerprint(fresh.db));
  });
});
