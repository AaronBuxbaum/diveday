import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { anonymizeDiver } from "@/features/records/anonymize";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { mergeDiverRecords } from "./diver-merge";
import { loadDiverExportBundleInput, loadShopExportBundleInput } from "./export";
import { table } from "./export-bundle-table.test-support";
import {
  computerDiveProfiles,
  computerDives,
  computerImportBatches,
  people,
  personRoles,
  shops,
} from "./schema";
import { clearDemoSchedule, deleteDemoShopCascade } from "./seed";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  // The canonical demo seeds one computer dive for its recap diver; these counts are the test's own.
  await db.delete(computerDiveProfiles).where(eq(computerDiveProfiles.shopId, shop.id));
  await db.delete(computerDives).where(eq(computerDives.shopId, shop.id));
  await db.delete(computerImportBatches).where(eq(computerImportBatches.shopId, shop.id));
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [source, survivor] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Computer Diver" },
      { shopId: shop.id, fullName: "Computer Diver" },
    ])
    .returning();
  if (!owner || !source || !survivor) throw new Error("fixture missing");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  return { db, shop, owner, source, survivor };
}

async function recording(
  personId: string,
  fingerprint: string,
  annotation: string,
  shopId = ctx.shop.id,
) {
  const { db } = ctx;
  const shop = { id: shopId };
  const [batch] = await db
    .insert(computerImportBatches)
    .values({
      shopId: shop.id,
      personId,
      requestKey: `request-${personId}`,
      selectionHash: fingerprint,
      importedCount: 1,
      skippedCount: 0,
    })
    .returning();
  if (!batch) throw new Error("batch missing");
  const [dive] = await db
    .insert(computerDives)
    .values({
      shopId: shop.id,
      personId,
      batchId: batch.id,
      fingerprint,
      record: { localStart: "2026-01-02T23:50:00", startInstant: null },
      annotation,
      deletedAt: nowDate(),
    })
    .returning();
  if (!dive) throw new Error("dive missing");
  await db.insert(computerDiveProfiles).values({
    shopId: shop.id,
    personId,
    diveId: dive.id,
    samples: [
      { seconds: 0, depthMeters: 0 },
      { seconds: 1200, depthMeters: 18 },
    ],
  });
  return dive;
}

describe("personal computer evidence lifecycle", () => {
  it.each(["reset", "reap"] as const)(
    "clears personal computer evidence during shop %s",
    async (operation) => {
      const { db, shop: existingShop } = ctx;
      const [shop] = await db
        .insert(shops)
        .values({
          slug: `computer-${operation}`,
          name: "Computer fixture",
          timezone: "UTC",
          isDemo: true,
        })
        .returning();
      if (!shop) throw new Error("shop fixture missing");
      const [person] = await db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Computer fixture" })
        .returning();
      if (!person) throw new Error("person fixture missing");
      await recording(person.id, "cleared", "Private source", shop.id);
      if (operation === "reset") await clearDemoSchedule(db, shop.id);
      else await deleteDemoShopCascade(db, shop.id);
      expect(
        await db
          .select()
          .from(computerImportBatches)
          .where(eq(computerImportBatches.shopId, shop.id)),
      ).toEqual([]);
      expect(
        await db.select().from(computerDives).where(eq(computerDives.shopId, shop.id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(computerDiveProfiles)
          .where(eq(computerDiveProfiles.shopId, shop.id)),
      ).toEqual([]);
      expect((await db.select().from(shops).where(eq(shops.id, existingShop.id)))[0]?.id).toBe(
        existingShop.id,
      );
    },
  );
  it("exports deleted recordings, annotations and profiles only to their subject", async () => {
    const { db, shop, source, survivor } = await fixture();
    const own = await recording(source.id, "own", "My corrected site");
    const other = await recording(survivor.id, "other", "Another person's note");
    const bundle = await loadDiverExportBundleInput(db, shop.id, source.id);
    if (!bundle) throw new Error("bundle missing");
    const dives = bundle.tables.find((entry) => entry.file === "computer_dives.csv");
    if (!dives) throw new Error("computer dive export missing");
    expect(dives.rows).toHaveLength(1);
    expect(dives.rows[0]).toContain(own.id);
    expect(dives.rows[0]).toContain("My corrected site");
    expect(JSON.stringify(bundle)).not.toContain(other.id);
    expect(
      bundle.tables.find((entry) => entry.file === "computer_dive_profiles.csv")?.rows,
    ).toHaveLength(1);
    const shopBundle = await loadShopExportBundleInput(db, shop.id);
    if (!shopBundle) throw new Error("shop bundle missing");
    expect(table(shopBundle, "computer_dives.csv").rows).toHaveLength(2);
  });

  it("erases the subject's batches, deleted records and profiles without erasing somebody else's", async () => {
    const { db, shop, owner, source, survivor } = await fixture();
    await recording(source.id, "own", "Private note");
    const other = await recording(survivor.id, "other", "Keep this");
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: source.id, actorPersonId: owner.id }),
    ).toMatchObject({ ok: true });
    expect(
      await db
        .select()
        .from(computerImportBatches)
        .where(eq(computerImportBatches.personId, source.id)),
    ).toEqual([]);
    expect(
      await db.select().from(computerDives).where(eq(computerDives.personId, source.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(computerDiveProfiles)
        .where(eq(computerDiveProfiles.personId, source.id)),
    ).toEqual([]);
    expect(
      (await db.select().from(computerDives).where(eq(computerDives.id, other.id)))[0]?.annotation,
    ).toBe("Keep this");
  });

  it("moves the complete personal evidence graph on merge", async () => {
    const { db, shop, owner, source, survivor } = await fixture();
    const own = await recording(source.id, "own", "Keep annotations");
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await db.select().from(computerDives).where(eq(computerDives.id, own.id)))[0],
    ).toMatchObject({ personId: survivor.id, annotation: "Keep annotations" });
    expect(
      (
        await db.select().from(computerDiveProfiles).where(eq(computerDiveProfiles.diveId, own.id))
      )[0]?.personId,
    ).toBe(survivor.id);
    expect(
      (
        await db
          .select()
          .from(computerImportBatches)
          .where(eq(computerImportBatches.id, own.batchId))
      )[0]?.personId,
    ).toBe(survivor.id);
  });

  it("refuses an exact-fingerprint merge collision atomically and preserves both annotations", async () => {
    const { db, shop, owner, source, survivor } = await fixture();
    const first = await recording(source.id, "same", "First correction");
    const second = await recording(survivor.id, "same", "Second correction");
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "record_conflict" });
    expect(
      (await db.select().from(computerDives).where(eq(computerDives.id, first.id)))[0],
    ).toMatchObject({ personId: source.id, annotation: "First correction" });
    expect(
      (await db.select().from(computerDives).where(eq(computerDives.id, second.id)))[0],
    ).toMatchObject({ personId: survivor.id, annotation: "Second correction" });
    expect(
      (await db.select().from(people).where(eq(people.id, source.id)))[0]?.deletedAt,
    ).toBeNull();
    expect(await db.select().from(computerDiveProfiles)).toHaveLength(2);
  });
});
