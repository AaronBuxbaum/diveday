import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import {
  consumeBookkeeperConfirmation,
  issueBookkeeperConfirmation,
  readBookkeeper,
  setBookkeeper,
} from "./bookkeeper";
import { people, personRoles, shops } from "./schema";

/**
 * Erasure reaches the bookkeeper's address (fifth loop, item 35), as it does
 * the shore contact's: a diver whose address a shop also set as its month-end
 * recipient asks to be forgotten, and the month stops leaving for it. An
 * address that is not theirs is left alone.
 */
describe("anonymizeDiver — the bookkeeper's address", () => {
  async function setup(bookkeeper: string) {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Bea Books", email: "Bea@Example.com" })
      .returning();
    if (!diver) throw new Error("diver insert failed");
    const now = new Date("2026-10-15T12:00:00Z");
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email: bookkeeper,
      personId: owner.id,
      now,
    });
    const issued = await issueBookkeeperConfirmation(db, { shopId: shop.id, email: bookkeeper, now });
    await consumeBookkeeperConfirmation(db, { token: issued?.token ?? "", now });
    const erase = () =>
      anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: owner.id });
    const row = async () => (await db.select().from(shops).where(eq(shops.id, shop.id)))[0];
    return { erase, read: () => readBookkeeper(db, shop.id), row };
  }

  it("clears the address, its confirmation and its link's hash when it is the erased diver's", async () => {
    const { erase, read, row } = await setup("bea@example.com");
    expect((await row())?.bookkeeperConfirmTokenHash).not.toBeNull();
    expect((await erase()).ok).toBe(true);
    expect(await read()).toBeNull();
    expect(await row()).toMatchObject({
      bookkeeperSentMonth: null,
      bookkeeperConfirmedAt: null,
      bookkeeperConfirmTokenHash: null,
      bookkeeperConfirmExpiresAt: null,
    });
  });

  it("leaves somebody else's address alone", async () => {
    const { erase, read } = await setup("books@ledger.example");
    expect((await erase()).ok).toBe(true);
    expect((await read())?.email).toBe("books@ledger.example");
  });
});
