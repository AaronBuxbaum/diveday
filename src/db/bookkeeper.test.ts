import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  checkBookkeeperConfirmation,
  claimBookkeeperMonth,
  consumeBookkeeperConfirmation,
  isBookkeeperToken,
  issueBookkeeperConfirmation,
  listBookkeeperShops,
  readBookkeeper,
  releaseBookkeeperMonth,
  setBookkeeper,
  wasBookkeeperConfirmed,
} from "./bookkeeper";
import type { AppDb } from "./client";
import { shops } from "./schema";

/**
 * The bookkeeper's address, its confirmation and the month-end claim (fifth
 * loop, item 35; security review B1), over an unseeded database so every shop
 * is the test's own.
 */

const TZ = "America/New_York";
const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OCT_20 = new Date("2026-10-20T15:00:00Z");
const BOOKS = "books@example.com";

async function shopRow(db: AppDb, slug: string, values: Partial<typeof shops.$inferInsert> = {}) {
  const [row] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: TZ, ...values })
    .returning();
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

const rowOf = async (db: AppDb, shopId: string) =>
  (await db.select().from(shops).where(eq(shops.id, shopId)))[0];

const set = (db: AppDb, shopId: string, email: string | null, personId = PERSON, now = OCT_20) =>
  setBookkeeper(db, { shopId, timeZone: TZ, email, personId, now });

/** Sets the address and confirms it through its link. */
async function confirmed(db: AppDb, shopId: string, email = BOOKS) {
  await set(db, shopId, email);
  const issued = await issueBookkeeperConfirmation(db, { shopId, email, now: OCT_20 });
  if (!issued) throw new Error("no link");
  await consumeBookkeeperConfirmation(db, { token: issued.token, now: OCT_20 });
  return issued.token;
}

describe("setBookkeeper", () => {
  it("keeps who set the address and when, unconfirmed, and counts the month due as sent", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-set");
    expect(await set(db, shopId, BOOKS)).toEqual({ change: "set", confirmed: false });
    expect(await readBookkeeper(db, shopId)).toMatchObject({
      email: BOOKS,
      setAt: OCT_20,
      setByPersonId: PERSON,
      confirmedAt: null,
    });
    expect((await rowOf(db, shopId))?.bookkeeperSentMonth).toBe("2026-09");
  });

  it("clears the address, its provenance, its confirmation, its link and the claim together", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-clear");
    await confirmed(db, shopId);
    expect(await set(db, shopId, null)).toEqual({ change: "cleared", confirmed: false });
    expect(await readBookkeeper(db, shopId)).toBeNull();
    expect(await rowOf(db, shopId)).toMatchObject({
      bookkeeperSentMonth: null,
      bookkeeperConfirmedAt: null,
      bookkeeperConfirmTokenHash: null,
      bookkeeperConfirmExpiresAt: null,
    });
    expect(await set(db, shopId, null)).toEqual({ change: "none", confirmed: false });
  });

  it("re-records the saver of the same address, leaving the claim and the confirmation alone", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-same");
    await confirmed(db, shopId);
    expect(await claimBookkeeperMonth(db, { shopId, email: BOOKS, month: "2026-10" })).toBe(true);
    const later = new Date("2026-11-05T15:00:00Z");
    expect(await set(db, shopId, BOOKS, OTHER, later)).toEqual({
      change: "resaved",
      confirmed: true,
    });
    expect(await rowOf(db, shopId)).toMatchObject({
      bookkeeperSentMonth: "2026-10",
      bookkeeperEmailSetByPersonId: OTHER,
      bookkeeperEmailSetAt: later,
    });
    expect((await readBookkeeper(db, shopId))?.confirmedAt).toEqual(OCT_20);
  });

  it("drops the confirmation when the address changes, so the new inbox must say yes", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-change");
    const oldLink = await confirmed(db, shopId);
    expect(await set(db, shopId, "new@example.com")).toEqual({ change: "changed", confirmed: false });
    expect((await readBookkeeper(db, shopId))?.confirmedAt).toBeNull();
    expect(await listBookkeeperShops(db)).toEqual([]);
    // The old link is gone with its address.
    expect(await isBookkeeperToken(db, { token: oldLink })).toBe(false);
  });

  it("refuses an address with no record of who set it, and a confirmation with no address", async () => {
    const db = await unseededTestDb();
    await expect(shopRow(db, "books-bare", { bookkeeperEmail: BOOKS })).rejects.toThrow();
    await expect(shopRow(db, "books-orphan", { bookkeeperConfirmedAt: OCT_20 })).rejects.toThrow();
  });
});

describe("the confirm link", () => {
  it("confirms only the address it was minted for, once, before it expires", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-link");
    await set(db, shopId, BOOKS);
    expect(await issueBookkeeperConfirmation(db, { shopId, email: "x@example.com", now: OCT_20 })).toBeNull();
    const issued = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    if (!issued) throw new Error("no link");
    expect(await checkBookkeeperConfirmation(db, { token: issued.token, now: OCT_20 })).toEqual({
      shopName: "books-link",
      email: BOOKS,
    });
    // Past its week, it confirms nothing.
    const late = new Date(issued.expiresAt.getTime() + 1);
    expect(await consumeBookkeeperConfirmation(db, { token: issued.token, now: late })).toBeNull();
    expect(await consumeBookkeeperConfirmation(db, { token: issued.token, now: OCT_20 })).toEqual({
      shopId,
    });
    expect(await wasBookkeeperConfirmed(db, { token: issued.token })).toEqual({
      shopName: "books-link",
    });
    expect(await consumeBookkeeperConfirmation(db, { token: issued.token, now: OCT_20 })).toBeNull();
    // A confirmed address mints no second link.
    expect(await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 })).toBeNull();
  });

  it("is replaced by a newer link", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-relink");
    await set(db, shopId, BOOKS);
    const first = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    const second = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    if (!first || !second) throw new Error("no link");
    expect(await consumeBookkeeperConfirmation(db, { token: first.token, now: OCT_20 })).toBeNull();
    expect(await consumeBookkeeperConfirmation(db, { token: second.token, now: OCT_20 })).toEqual({
      shopId,
    });
  });
});

describe("the month-end claim", () => {
  it("is won once per month, and only for the confirmed address still on file", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-claim");
    await set(db, shopId, BOOKS);
    const claim = { shopId, email: BOOKS, month: "2026-10" };
    // Unconfirmed: nothing to claim.
    expect(await claimBookkeeperMonth(db, claim)).toBe(false);
    const issued = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    await consumeBookkeeperConfirmation(db, { token: issued?.token ?? "", now: OCT_20 });
    expect(await claimBookkeeperMonth(db, { ...claim, email: "old@example.com" })).toBe(false);
    expect(await claimBookkeeperMonth(db, claim)).toBe(true);
    expect(await claimBookkeeperMonth(db, claim)).toBe(false);
    // A failed send gives it back, and the next pass wins it again.
    await releaseBookkeeperMonth(db, { shopId, month: "2026-10", previous: "2026-09" });
    expect((await rowOf(db, shopId))?.bookkeeperSentMonth).toBe("2026-09");
    expect(await claimBookkeeperMonth(db, claim)).toBe(true);
  });

  it("lists real shops with a confirmed address, never a demo shop or an unconfirmed one", async () => {
    const db = await unseededTestDb();
    const real = await shopRow(db, "books-real");
    const demo = await shopRow(db, "books-demo", { isDemo: true });
    const waiting = await shopRow(db, "books-waiting");
    await shopRow(db, "books-none");
    await confirmed(db, real);
    await confirmed(db, demo);
    await set(db, waiting, BOOKS);
    expect((await listBookkeeperShops(db)).map((shop) => shop.id)).toEqual([real]);
  });
});
