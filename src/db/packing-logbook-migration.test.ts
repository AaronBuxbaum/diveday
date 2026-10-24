// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { shops } from "./schema";

/**
 * The data migration that takes a typed "Logbook" line out of each shop's
 * packing list now that `packing_logbook` suggests it (issue #2795, H-49: the
 * data moves, no code keeps reading the old line). `createTestDb()` has
 * already applied it to an empty database, so the test writes lists in the old
 * shape and runs the migration's own SQL over them.
 */
const ctx = fileScopedShopContext();

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const FOLDER = readdirSync(MIGRATIONS).find((name) =>
  name.endsWith("_packing-list-drops-logbook-line"),
);

async function runMigration() {
  if (!FOLDER) throw new Error("the packing-list-drops-logbook-line migration is missing");
  const text = readFileSync(path.join(MIGRATIONS, FOLDER, "migration.sql"), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.trim()) await ctx.db.execute(sql.raw(statement));
  }
}

async function listAfter(packingList: string[], packingLogbook = true) {
  const { db, shop } = ctx;
  await db.update(shops).set({ packingList, packingLogbook }).where(eq(shops.id, shop.id));
  await runMigration();
  const [row] = await db
    .select({ packingList: shops.packingList, packingLogbook: shops.packingLogbook })
    .from(shops)
    .where(eq(shops.id, shop.id));
  return row;
}

describe("the packing list logbook migration", () => {
  it("drops a standalone Logbook line, whatever its case and spacing, and keeps the rest in order", async () => {
    expect(
      await listAfter(["Swimsuit and towel", "Logbook", "Reef-safe sun protection", " logbook "]),
    ).toEqual({
      packingList: ["Swimsuit and towel", "Reef-safe sun protection"],
      packingLogbook: true,
    });
  });

  it("leaves a line that only mentions a logbook alone", async () => {
    const list = ["Logbook and pen", "Your logbook, if you have one", "Log book"];
    expect((await listAfter(list)).packingList).toEqual(list);
  });

  it("turns the flag on for a shop that had typed the line but switched the suggestion off", async () => {
    // The shop asked for a logbook in its own words; the flag now says it.
    expect(await listAfter(["Logbook"], false)).toEqual({ packingList: [], packingLogbook: true });
  });

  it("leaves a list with no Logbook line and its flag as they were", async () => {
    expect(await listAfter(["Swimsuit and towel"], false)).toEqual({
      packingList: ["Swimsuit and towel"],
      packingLogbook: false,
    });
  });
});
