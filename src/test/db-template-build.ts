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
  try {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: "drizzle" });
    // Empty is migrated only; history adds the back-fill reporting tests need.
    if (variant !== "empty") await seedDemo(db, variant);
    const dump = await client.dumpDataDir("none");
    return Buffer.from(await dump.arrayBuffer());
  } finally {
    await closePglite(client);
  }
}
