import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  claimBookkeeperMonth,
  listBookkeeperShops,
  readBookkeeper,
  releaseBookkeeperMonth,
  setBookkeeper,
} from "./bookkeeper";
import type { AppDb } from "./client";
import { shops } from "./schema";

/**
 * The bookkeeper's address and the month-end claim (fifth loop, item 35), over
 * an unseeded database so every shop is the test's own.
 */

const TZ = "America/New_York";
const PERSON = "11111111-1111-4111-8111-111111111111";
const OCT_20 = new Date("2026-10-20T15:00:00Z");

async function shopRow(db: AppDb, slug: string, values: Partial<typeof shops.$inferInsert> = {}) {
  const [row] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: TZ, ...values })
    .returning();
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

const sentMonthOf = async (db: AppDb, shopId: string) =>
  (await db.select().from(shops).where(eq(shops.id, shopId)))[0]?.bookkeeperSentMonth;

describe("setBookkeeper", () => {
  it("keeps who set the address and when, and counts the month due as sent", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-set");
    await setBookkeeper(db, {
      shopId,
      timeZone: TZ,
      email: "books@example.com",
      personId: PERSON,
      now: OCT_20,
    });
    expect(await readBookkeeper(db, shopId)).toEqual({ email: "books@example.com", setAt: OCT_20 });
    const [row] = await db.select().from(shops).where(eq(shops.id, shopId));
    expect(row?.bookkeeperEmailSetByPersonId).toBe(PERSON);
    expect(row?.bookkeeperSentMonth).toBe("2026-09");
  });

  it("clears the address, who set it and the claim together", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-clear");
    const base = { shopId, timeZone: TZ, personId: PERSON, now: OCT_20 };
    await setBookkeeper(db, { ...base, email: "books@example.com" });
    await setBookkeeper(db, { ...base, email: null });
    expect(await readBookkeeper(db, shopId)).toBeNull();
    expect(await sentMonthOf(db, shopId)).toBeNull();
  });

  it("leaves the claim alone when the same address is saved again", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-same");
    const base = { shopId, timeZone: TZ, personId: PERSON, email: "books@example.com" };
    await setBookkeeper(db, { ...base, now: OCT_20 });
    expect(await claimBookkeeperMonth(db, { shopId, email: base.email, month: "2026-10" })).toBe(
      true,
    );
    await setBookkeeper(db, { ...base, now: new Date("2026-11-05T15:00:00Z") });
    expect(await sentMonthOf(db, shopId)).toBe("2026-10");
  });

  it("refuses an address with no record of who set it", async () => {
    const db = await unseededTestDb();
    await expect(
      shopRow(db, "books-bare", { bookkeeperEmail: "books@example.com" }),
    ).rejects.toThrow();
  });
});

describe("the month-end claim", () => {
  it("is won once per month, and only for the address still on file", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-claim");
    await setBookkeeper(db, {
      shopId,
      timeZone: TZ,
      email: "books@example.com",
      personId: PERSON,
      now: OCT_20,
    });
    const claim = { shopId, email: "books@example.com", month: "2026-10" };
    expect(await claimBookkeeperMonth(db, { ...claim, email: "old@example.com" })).toBe(false);
    expect(await claimBookkeeperMonth(db, claim)).toBe(true);
    expect(await claimBookkeeperMonth(db, claim)).toBe(false);
    // A failed send gives it back, and the next pass wins it again.
    await releaseBookkeeperMonth(db, { shopId, month: "2026-10", previous: "2026-09" });
    expect(await sentMonthOf(db, shopId)).toBe("2026-09");
    expect(await claimBookkeeperMonth(db, claim)).toBe(true);
  });

  it("lists real shops with an address, never a demo shop", async () => {
    const db = await unseededTestDb();
    const real = await shopRow(db, "books-real");
    const demo = await shopRow(db, "books-demo", { isDemo: true });
    await shopRow(db, "books-none");
    for (const shopId of [real, demo]) {
      await setBookkeeper(db, {
        shopId,
        timeZone: TZ,
        email: "books@example.com",
        personId: PERSON,
        now: OCT_20,
      });
    }
    expect((await listBookkeeperShops(db)).map((shop) => shop.id)).toEqual([real]);
  });
});
