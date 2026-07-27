// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  joinLastMinuteList,
  listLastMinuteList,
  unsubscribeLastMinuteListEntry,
} from "./last-minute-list";
import { shops } from "./schema";

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

describe("joinLastMinuteList (in-memory PGlite)", () => {
  it("adds a diver with no capacity check, regardless of any trip", async () => {
    const { db, shop } = await seededShopContext();
    const outcome = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    expect(outcome.personName).toBe("Nora Quinn");
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.id).toBe(outcome.entryId);
    expect(list[0]?.entry.availableFrom).toBeNull();
    expect(list[0]?.entry.availableUntil).toBeNull();
  });

  it("stores the stated date range", async () => {
    const { db, shop } = await seededShopContext();
    await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2026-08-01",
      availableUntil: "2026-08-10",
    });
    const [row] = await listLastMinuteList(db, shop.id);
    expect(row?.entry.availableFrom).toBe("2026-08-01");
    expect(row?.entry.availableUntil).toBe("2026-08-10");
  });

  it("reuses the same person and updates the range on a re-submission, keyed by email", async () => {
    const { db, shop } = await seededShopContext();
    const first = await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2026-08-01",
    });
    const again = await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      email: "NORA@example.com",
      availableFrom: "2026-09-01",
      availableUntil: "2026-09-10",
    });

    expect(again.entryId).toBe(first.entryId);
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.availableFrom).toBe("2026-09-01");
    expect(list[0]?.entry.availableUntil).toBe("2026-09-10");
  });

  it("reactivates an unsubscribed entry on re-submission", async () => {
    const { db, shop } = await seededShopContext();
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await unsubscribeLastMinuteListEntry(db, { shopId: shop.id, entryId: joined.entryId });
    expect(await listLastMinuteList(db, shop.id)).toEqual([]);

    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.unsubscribedAt).toBeNull();
  });
});

describe("unsubscribeLastMinuteListEntry", () => {
  it("refuses to unsubscribe an entry from another shop", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-last-minute-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });

    await expect(
      unsubscribeLastMinuteListEntry(db, { shopId: otherShop.id, entryId: joined.entryId }),
    ).resolves.toBe(false);
    expect(await listLastMinuteList(db, shop.id)).toHaveLength(1);
  });
});

describe("listLastMinuteList cross-tenant isolation", () => {
  it("a shop never sees another shop's last-minute-list entries", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-last-minute-list", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    expect(await listLastMinuteList(db, otherShop.id)).toEqual([]);
  });
});
