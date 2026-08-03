// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  dischargeProcessorErasure,
  listOwedProcessorErasures,
  recordProcessorErasureObligations,
} from "./processor-erasure";
import { people, processorErasureObligations, shops } from "./schema";

async function personIdByName(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)));
  if (!row) throw new Error(`seed person missing: ${fullName}`);
  return row.id;
}

/** A second shop with a diver of its own, for the tenant-scoping assertions. */
async function twoShops() {
  const { db, shop } = await seededShopContext();
  const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
  const [otherShop] = await db
    .insert(shops)
    .values({ name: "Other Shop", slug: "other-shop-processor-erasure", timezone: "UTC" })
    .returning();
  if (!otherShop) throw new Error("second shop insert failed");
  const [otherPerson] = await db
    .insert(people)
    .values({ shopId: otherShop.id, fullName: "Other Diver" })
    .returning();
  if (!otherPerson) throw new Error("second shop person insert failed");
  return { db, shop, ownerId, otherShop, otherPerson };
}

describe("processor erasure obligations", () => {
  it("raises one row per distinct customer id and ignores blanks", async () => {
    const { db, shop, ownerId } = await twoShops();
    const raised = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      stripeCustomerIds: ["cus_a", "cus_b", "cus_a", "  ", ""],
    });
    expect(raised).toBe(2);
    const owed = await listOwedProcessorErasures(db, shop.id);
    expect(owed.map((row) => row.externalId).sort()).toEqual(["cus_a", "cus_b"]);
    expect(owed.every((row) => row.status === "owed" && row.dischargedAt === null)).toBe(true);
  });

  it("records nothing when the diver's orders name no customer at all", async () => {
    const { db, shop, ownerId } = await twoShops();
    expect(
      await recordProcessorErasureObligations(db, {
        shopId: shop.id,
        personId: ownerId,
        stripeCustomerIds: [],
      }),
    ).toBe(0);
    expect(await listOwedProcessorErasures(db, shop.id)).toEqual([]);
  });

  it("folds a repeat obligation onto the existing row instead of duplicating the work", async () => {
    const { db, shop, ownerId } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      stripeCustomerIds: ["cus_shared"],
    });
    const second = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      stripeCustomerIds: ["cus_shared"],
    });
    expect(second).toBe(0);
    expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(1);
  });

  it("keeps one shop's obligations out of another's, even on the same customer id", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      stripeCustomerIds: ["cus_same"],
    });
    await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      stripeCustomerIds: ["cus_same"],
    });

    const mine = await listOwedProcessorErasures(db, shop.id);
    const theirs = await listOwedProcessorErasures(db, otherShop.id);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    // Two separate Stripe accounts can genuinely hold the same-looking handle;
    // the unique index is per shop, so neither shop swallows the other's work.
    expect(mine[0]?.id).not.toBe(theirs[0]?.id);
    expect(mine[0]?.shopId).toBe(shop.id);
    expect(theirs[0]?.shopId).toBe(otherShop.id);
  });

  it("discharges an obligation and records who attested it", async () => {
    const { db, shop, ownerId } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      stripeCustomerIds: ["cus_done"],
    });
    const [owed] = await listOwedProcessorErasures(db, shop.id);
    if (!owed) throw new Error("obligation missing");

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: owed.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: true });

    expect(await listOwedProcessorErasures(db, shop.id)).toEqual([]);
    const [row] = await db
      .select()
      .from(processorErasureObligations)
      .where(eq(processorErasureObligations.id, owed.id));
    expect(row).toMatchObject({ status: "discharged", dischargedByPersonId: ownerId });
    expect(row?.dischargedAt).toBeInstanceOf(Date);
  });

  it("refuses to discharge a second time — a replayed submit rewrites no attestation", async () => {
    const { db, shop, ownerId } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      stripeCustomerIds: ["cus_twice"],
    });
    const [owed] = await listOwedProcessorErasures(db, shop.id);
    if (!owed) throw new Error("obligation missing");
    await dischargeProcessorErasure(db, {
      shopId: shop.id,
      obligationId: owed.id,
      actorPersonId: ownerId,
    });
    const [afterFirst] = await db
      .select()
      .from(processorErasureObligations)
      .where(eq(processorErasureObligations.id, owed.id));

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: owed.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    const [afterSecond] = await db
      .select()
      .from(processorErasureObligations)
      .where(eq(processorErasureObligations.id, owed.id));
    expect(afterSecond?.dischargedAt).toEqual(afterFirst?.dischargedAt);
    expect(afterSecond?.dischargedByPersonId).toBe(afterFirst?.dischargedByPersonId);
  });

  it("refuses to discharge another shop's obligation, and leaves it standing", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      stripeCustomerIds: ["cus_theirs"],
    });
    const [theirs] = await listOwedProcessorErasures(db, otherShop.id);
    if (!theirs) throw new Error("obligation missing");

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: theirs.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await listOwedProcessorErasures(db, otherShop.id)).toHaveLength(1);
  });
});
