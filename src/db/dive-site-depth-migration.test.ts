// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { diveSites, globalDiveSites, globalDiveSiteVersions } from "./schema";

/**
 * The migration that turns a dive site's depth prose into two numbers (issue
 * #2426, option 1). `createTestDb()` has applied it to an empty database, so the
 * test writes rows in the old shape and runs the migration's own UPDATEs.
 */
const ctx = fileScopedShopContext();

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const FOLDER = readdirSync(MIGRATIONS).find((name) => name.endsWith("_dive-site-depth-range"));

async function runBackfill() {
  if (!FOLDER) throw new Error("the dive-site-depth-range migration is missing");
  const text = readFileSync(path.join(MIGRATIONS, FOLDER, "migration.sql"), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    // The ADD COLUMN and the CHECK are already in place; only the data moves.
    if (/^\s*(?:--[^\n]*\n\s*)*UPDATE/.test(statement)) await ctx.db.execute(sql.raw(statement));
  }
}

async function site(name: string, depthRange: string | null, maxDepthMeters: number | null = null) {
  const [row] = await ctx.db
    .insert(diveSites)
    .values({
      shopId: ctx.shop.id,
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
      depthRange,
      maxDepthMeters,
    })
    .returning();
  if (!row) throw new Error("site insert failed");
  return row;
}

async function read(id: string) {
  const [row] = await ctx.db.select().from(diveSites).where(eq(diveSites.id, id));
  if (!row) throw new Error("site missing");
  return row;
}

describe("the dive-site depth range migration", () => {
  it("reads a range typed in metres, in feet, or both, and clears the note it read", async () => {
    const metres = await site("Metres", "6–12 m", 12);
    const feet = await site("Feet", "20 to 45 ft", 13.716);
    const both = await site("Both", "15–28 m (50–90 ft)", 28);
    const spanish = await site("Spanish", "20 a 45 pies");

    await runBackfill();

    expect(await read(metres.id)).toMatchObject({
      depthMinMeters: 6,
      maxDepthMeters: 12,
      depthRange: null,
    });
    const fromFeet = await read(feet.id);
    expect(fromFeet.depthMinMeters).toBeCloseTo(6.096, 3);
    expect(fromFeet.maxDepthMeters).toBe(13.716);
    expect(fromFeet.depthRange).toBeNull();
    expect(await read(both.id)).toMatchObject({ depthMinMeters: 15, maxDepthMeters: 28 });
    const es = await read(spanish.id);
    expect(es.depthMinMeters).toBeCloseTo(6.096, 3);
    // No maximum was recorded, so the range's deep end becomes it.
    expect(es.maxDepthMeters).toBeCloseTo(13.716, 3);
  });

  it("reads 'up to' as a deepest point only", async () => {
    const upTo = await site("Up To", "Up to 18 m (60 ft)");
    await runBackfill();
    expect(await read(upTo.id)).toMatchObject({
      depthMinMeters: null,
      maxDepthMeters: 18,
      depthRange: null,
    });
  });

  it("keeps the prose it cannot read, and never contradicts a recorded maximum", async () => {
    const ledge = await site("Ledge", "shallow ledge to 18", 18);
    const noUnit = await site("No Unit", "6–12");
    const mixed = await site("Mixed", "6–12 m, sandy patches", 12);
    // Prose says 12 m, the number says 30: the number a ceiling compares against wins, and the note stays.
    const clash = await site("Clash", "6–12 m", 30);
    const blank = await site("Blank", null);

    await runBackfill();

    for (const [row, note] of [
      [ledge, "shallow ledge to 18"],
      [noUnit, "6–12"],
      [mixed, "6–12 m, sandy patches"],
      [clash, "6–12 m"],
    ] as const) {
      expect(await read(row.id)).toMatchObject({ depthMinMeters: null, depthRange: note });
    }
    expect((await read(clash.id)).maxDepthMeters).toBe(30);
    expect(await read(blank.id)).toMatchObject({ depthMinMeters: null, depthRange: null });
  });

  it("moves the catalog's published briefings onto the numbers", async () => {
    const [global] = await ctx.db
      .insert(globalDiveSites)
      .values({ slug: "migration-reef", currentVersion: 1 })
      .returning();
    if (!global) throw new Error("global site insert failed");
    const [version] = await ctx.db
      .insert(globalDiveSiteVersions)
      .values({
        globalDiveSiteId: global.id,
        version: 1,
        briefing: { name: "Migration Reef", depthRange: "9–24 m (30–80 ft)", maxDepthMeters: 24 },
      })
      .returning();
    if (!version) throw new Error("version insert failed");

    await runBackfill();

    const [after] = await ctx.db
      .select({ briefing: globalDiveSiteVersions.briefing })
      .from(globalDiveSiteVersions)
      .where(eq(globalDiveSiteVersions.id, version.id));
    expect(after?.briefing).toEqual({
      name: "Migration Reef",
      depthMinMeters: 9,
      maxDepthMeters: 24,
    });
  });
});
