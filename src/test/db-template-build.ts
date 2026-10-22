import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { closePglite } from "@/db/close-pglite";
import { seedDemo } from "@/db/seed";
import type { TemplateVariant } from "./db-template-read";

/** Migrate (and, for the seeded variants, seed) one variant and dump its data directory. */
export async function buildSnapshot(variant: TemplateVariant): Promise<Buffer> {
  const client = new PGlite({ extensions: { pg_trgm, btree_gist } });
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "drizzle" });
  if (variant === "empty") {
    const emptyDump = await client.dumpDataDir("none");
    await closePglite(client);
    return Buffer.from(await emptyDump.arrayBuffer());
  }
  // The `lean` fixture has no trailing-quarter back-fill. That history is for
  // the demo experience, the e2e/visual-regression fleet, and the handful of
  // reporting-shaped unit tests that ask for `{ history: true }`; everything
  // else is calibrated to the small, controlled dataset and builds its own
  // history when it needs it (src/db/reporting.test.ts).
  await seedDemo(db, { history: variant === "history" });
  const dump = await client.dumpDataDir("none");
  await closePglite(client);
  return Buffer.from(await dump.arrayBuffer());
}
