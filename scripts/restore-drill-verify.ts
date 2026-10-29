/**
 * The half of the restore drill that proves a restored database is usable: sign in as a seeded
 * staffer, then read tomorrow's manifest in that staffer's shop
 * (docs/engineering/backup-and-restore-runbook.md, "Monthly restore drill").
 *
 *   RESTORE_DATABASE_URL=<the scratch branch's restore_drill database> pnpm exec tsx scripts/restore-drill-verify.ts
 *
 * `scripts/restore-drill.mjs` runs it after `pg_restore`; a human can run it the same way against a
 * branch they restored by hand. It reads and never writes.
 *
 * **It opens its own pool rather than calling `getDb()`.** `getDb()` seeds the demo shop on first
 * open, so a restore that lost the staffer's account would be repaired by the seed before this
 * looked, and the drill would pass on a database it had just written. Here nothing writes, so a
 * missing account is a failed drill.
 *
 * **The seeded staffer signs in the way a visitor does on production**: the seed stores a random
 * hash for each demo login and admits the demo password through the demo bypass
 * (`src/lib/demo-bypass.ts`), which needs `NODE_ENV=production` (or development) and a shop still
 * marked `is_demo`. So this proves the account, its person, its shop and its staff role came back
 * together, through `verifyCredentials`, the same function sign-in calls. A bcrypt compare against
 * a real staffer's own password is the hand step in the runbook's first-run checklist.
 *
 * Output is counts and ids, never a name, an email or a medical answer: the restored database holds
 * production's people, and this prints into a CI log.
 */
import { and, asc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AppDb } from "@/db/client";
import { withExplicitSslMode } from "@/db/connection-string";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { getTripManifest } from "@/db/manifests";
import { shops, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { listShopDayDepartures } from "@/db/trips-queries";
import { nowDate } from "@/lib/clock";
import { tomorrowNoon } from "@/lib/closeout";
import { verifyCredentials } from "@/lib/credentials";
import { DEMO_BYPASS_PASSWORD, demoBypassEnabled } from "@/lib/demo-bypass";

type Departure = { id: string; startsAt: Date };

/**
 * What the restore holds, by schema and table name only: counts and fixed table names, never a row.
 * Printed before sign-in so that a "relation does not exist" failure says where the tables are (or
 * that none came back) instead of leaving the next run to guess.
 */
async function logInventory(pool: Pool): Promise<void> {
  const schemas = await pool.query<{ table_schema: string; tables: string }>(
    `select table_schema, count(*) as tables from information_schema.tables
     where table_schema not in ('pg_catalog', 'information_schema') group by 1 order by 1`,
  );
  console.log(
    `restore-drill-verify: tables by schema: ${schemas.rows.map((row) => `${row.table_schema}=${row.tables}`).join(", ") || "none"}`,
  );
  const signIn = await pool.query<{ table_schema: string; table_name: string }>(
    `select table_schema, table_name from information_schema.tables
     where table_name in ('shops', 'people', 'user_accounts', 'person_roles') order by 1, 2`,
  );
  console.log(
    `restore-drill-verify: sign-in tables found: ${signIn.rows.map((row) => `${row.table_schema}.${row.table_name}`).join(", ") || "none"}`,
  );
}

/** Tomorrow's departures in the shop's own zone; when there are none, the next one after now. */
async function departuresToRead(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date,
): Promise<{ which: "tomorrow" | "next"; departures: Departure[] }> {
  const tomorrow = await listShopDayDepartures(db, shopId, timeZone, tomorrowNoon(now, timeZone));
  if (tomorrow.length > 0) return { which: "tomorrow", departures: tomorrow };
  const next = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  return { which: "next", departures: next };
}

async function main(): Promise<number> {
  const url = process.env.RESTORE_DATABASE_URL;
  if (!url) {
    console.error("restore-drill-verify: RESTORE_DATABASE_URL is not set.");
    return 2;
  }
  // One connection, short-lived: this is a check, not a server.
  const pool = new Pool({ connectionString: withExplicitSslMode(url), max: 1 });
  // An idle client's error would otherwise be an uncaught exception printing its message.
  pool.on("error", (error) => {
    console.error(`restore-drill-verify: pool ${redacted(error)}.`);
  });
  const db = drizzle({ client: pool }) as unknown as AppDb;
  try {
    if (!demoBypassEnabled()) {
      console.error(
        "restore-drill-verify: run with NODE_ENV=production, as production signs the seeded staff in through the demo bypass.",
      );
      return 2;
    }
    await logInventory(pool);
    const user = await verifyCredentials(db, DEV_STAFF_LOGINS.owner.email, DEMO_BYPASS_PASSWORD);
    if (!user) {
      console.error(
        "restore-drill-verify: FAILED sign-in. The seeded owner was refused on the restored database: the account, its person, its demo shop or its staff role did not come back together.",
      );
      return 1;
    }
    console.log(
      `restore-drill-verify: sign-in ok (shop ${user.shopId}, roles ${user.roles.join(",")})`,
    );

    const [shop] = await db
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, user.shopId));
    if (!shop) {
      console.error(
        "restore-drill-verify: FAILED. The staffer's shop is missing from the restore.",
      );
      return 1;
    }
    const now = nowDate();
    const { which, departures } = await departuresToRead(db, user.shopId, shop.timezone, now);
    if (departures.length === 0) {
      console.error(
        "restore-drill-verify: FAILED. The restored shop has no departure tomorrow and none after it, so no manifest was read.",
      );
      return 1;
    }
    for (const departure of departures) {
      const manifest = await getTripManifest(db, user.shopId, departure.id);
      if (!manifest) {
        console.error(
          `restore-drill-verify: FAILED. Trip ${departure.id}'s manifest did not load.`,
        );
        return 1;
      }
      console.log(
        `restore-drill-verify: manifest ok (${which}, trip ${departure.id}, ${departure.startsAt.toISOString()}, ${manifest.divers.length} divers, ${manifest.crew.length} crew)`,
      );
    }
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** The name and code only: a pg error message can quote a row. */
function redacted(error: unknown): string {
  // drizzle wraps the driver's error, so its SQLSTATE is on the cause.
  const failure = error as
    | { code?: unknown; cause?: { code?: unknown; message?: unknown } }
    | undefined;
  const code = failure?.code ?? failure?.cause?.code;
  const name = `${(error as Error | undefined)?.name ?? "an error"}${typeof code === "string" ? ` (${code})` : ""}`;
  // A missing relation's name is schema, not data: the one message fragment safe to print.
  const missing =
    code === "42P01"
      ? String(failure?.cause?.message ?? "").match(/^relation "([\w.]+)" does not exist$/)?.[1]
      : undefined;
  return missing ? `${name}, relation ${missing} missing` : name;
}

function fail(error: unknown): never {
  console.error(`restore-drill-verify: FAILED with ${redacted(error)}.`);
  process.exit(1);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
main().then((code) => process.exit(code), fail);
