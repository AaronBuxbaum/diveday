import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { readBookkeeper, setBookkeeper } from "./bookkeeper";
import { people, personRoles } from "./schema";

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
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email: bookkeeper,
      personId: owner.id,
      now: new Date("2026-10-15T12:00:00Z"),
    });
    const erase = () =>
      anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: owner.id });
    return { erase, read: () => readBookkeeper(db, shop.id) };
  }

  it("clears the address when it is the erased diver's", async () => {
    const { erase, read } = await setup("bea@example.com");
    expect((await erase()).ok).toBe(true);
    expect(await read()).toBeNull();
  });

  it("leaves somebody else's address alone", async () => {
    const { erase, read } = await setup("books@ledger.example");
    expect((await erase()).ok).toBe(true);
    expect((await read())?.email).toBe("books@ledger.example");
  });
});
