import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { shops } from "@/db/schema";
import { fileScopedEmptyContext, unseededTestDb } from "./db";

const context = fileScopedEmptyContext();
beforeEach(async () => {
  expect(await context.db.select().from(shops)).toEqual([]);
});
for (const slug of ["rollback-first", "rollback-second"]) {
  it(`rolls back ${slug} before the next case`, async () => {
    await context.db.insert(shops).values({ name: slug, slug, timezone: "UTC" });
    expect(await context.db.select().from(shops)).toHaveLength(1);
  });
}
it("matches a fresh migrated database for read projections", async () => {
  const fresh = await unseededTestDb();
  const query = sql`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  expect(await context.db.execute(query)).toEqual(await fresh.execute(query));
});
