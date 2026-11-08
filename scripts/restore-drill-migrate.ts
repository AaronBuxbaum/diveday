/**
 * Bring only the restored scratch database to the checked-out app's schema before its read-only
 * smoke test. Weekly dumps can predate new columns by days; running today's queries against the
 * untouched dump fails with 42703 even when pg_restore succeeded. Never seed missing records.
 * Invoke through restore-drill.mjs: that parent validates branch identity. This child validates
 * the database name and restored inventory, not whether a standalone URL belongs to a scratch branch.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { withExplicitSslMode } from "../src/db/connection-string";

export async function migrateRestoredDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // No DDL until the actual connection confirms the dedicated restore database and the dump's
    // core tables + migration ledger exist. An empty/partial restore must not be repaired by DDL.
    const { rows } = await client.query<{ ready: boolean }>(`
      select current_database() = 'restore_drill'
        and to_regclass('drizzle.__drizzle_migrations') is not null
        and to_regclass('public.people') is not null
        and to_regclass('public.user_accounts') is not null
        and to_regclass('public.shops') is not null
        and to_regclass('public.person_roles') is not null as ready
    `);
    if (!rows[0]?.ready) throw new Error("Restore target or restored inventory is invalid.");
    const ledger = await client.query<{ present: boolean }>(
      "select exists(select 1 from drizzle.__drizzle_migrations) as present",
    );
    if (!ledger.rows[0]?.present) throw new Error("The restored migration ledger is empty.");
    // pg_restore can leave the role's search_path empty. Pin the same connection used for DDL.
    await client.query("set search_path to public");
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const uri = process.env.RESTORE_DATABASE_URL;
  if (!uri || new URL(uri).pathname !== "/restore_drill") {
    throw new Error("RESTORE_DATABASE_URL must name the scratch restore_drill database.");
  }
  const pool = new Pool({ connectionString: withExplicitSslMode(uri), max: 1 });
  try {
    await migrateRestoredDatabase(pool);
    console.log("restore-drill-migrate: committed migrations applied; no demo seed run.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Neither the driver message nor its stack is safe: a failed data migration can quote rows.
  main().catch(() => {
    console.error(
      "restore-drill-migrate: FAILED; target validation or committed migration failed.",
    );
    process.exitCode = 1;
  });
}
