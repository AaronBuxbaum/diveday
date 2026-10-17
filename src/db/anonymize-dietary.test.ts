import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { bookings, people, personRoles } from "./schema";

/**
 * Erasure reaches the dietary note (fifth-loop ideas, item 56). A diver's
 * lunch preference is their own words, said for one boat's galley; a diver who asks
 * to be forgotten takes it back, like the welcome consent beside it.
 */
describe("anonymizeDiver — the dietary note", () => {
  it("clears the diver's lunch preference", async () => {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [booking] = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking");
    await db
      .update(bookings)
      .set({ dietaryNote: "no shellfish" })
      .where(eq(bookings.id, booking.id));

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const [after] = await db
      .select({ dietaryNote: bookings.dietaryNote })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(after?.dietaryNote).toBeNull();
  });
});
