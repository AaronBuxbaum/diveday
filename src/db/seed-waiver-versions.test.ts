import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isCompletedWaiverCurrent } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { waiverRecords } from "./schema";
import { getCurrentWaiverTemplate, listWaiverTemplateHistory } from "./waivers";

/**
 * The demo shop's release has a history behind it (src/db/seed-waiver-versions.ts).
 * These are the invariants the rest of the seed rests on, not a restatement of
 * the row count: the *newest* version has to be the live one, and every record
 * any scenario snapshotted has to have snapshotted that one — otherwise
 * `isCompletedWaiverCurrent` reads the shop's own seeded evidence as signed
 * against superseded terms, and every diver on the board loses their waiver.
 */
describe("seeded waiver template history", () => {
  it("keeps superseded wordings on file behind the live release", async () => {
    const { db, shop } = await seededShopContext();

    const history = await listWaiverTemplateHistory(db, shop.id);
    expect(history.map((row) => row.version)).toEqual([3, 2, 1]);
    // Gapless and one title throughout: the title is immutable in the UI, so
    // every version of a shop's release carries the shop's own.
    expect(new Set(history.map((row) => row.title)).size).toBe(1);
    // Each version is a genuinely different wording — a history of identical
    // bodies would teach nothing and hide a copy/paste bug in the seed.
    expect(new Set(history.map((row) => row.body)).size).toBe(history.length);
    // Saved in version order, oldest first, so "Version 3, saved <date>" on the
    // template page reads as the most recent edit.
    const savedAt = [...history].reverse().map((row) => row.createdAt.getTime());
    expect(savedAt).toEqual([...savedAt].sort((a, b) => a - b));
  });

  it("makes the newest version the live one", async () => {
    const { db, shop } = await seededShopContext();
    const current = await getCurrentWaiverTemplate(db, shop.id);
    // 3, matching the [3, 2, 1] history asserted above.
    expect(current?.version).toBe(3);
    const [newest] = await listWaiverTemplateHistory(db, shop.id);
    expect(current?.id).toBe(newest?.id);
  });

  it("leaves every seeded signature current against it, so no diver's release goes stale", async () => {
    // The whole reason `seedWaiverVersions` runs first: every later scenario
    // snapshots `getCurrentWaiverTemplate`, and a record carrying an older
    // `templateVersion` fails the currency check for good — a silent,
    // shop-wide readiness regression that no single spec would name.
    const { db, shop } = await seededShopContext();
    const current = await getCurrentWaiverTemplate(db, shop.id);
    if (!current) throw new Error("seeded waiver template missing");

    const signed = await db.select().from(waiverRecords).where(eq(waiverRecords.shopId, shop.id));
    const completed = signed.filter((record) => record.status === "completed");
    expect(completed.length).toBeGreaterThan(0);
    for (const record of completed) {
      expect(record.templateVersion).toBe(current.version);
      expect(isCompletedWaiverCurrent(record, current.materialGeneration)).toBe(true);
    }
  });
});
