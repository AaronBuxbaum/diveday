import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { heldRows } from "@/test/held-sends";
import { anonymizeDiver } from "../features/anonymize/store";
import { holdSend } from "./held-sends";
import { bookings, people, personRoles } from "./schema";

const ctx = fileScopedShopContext();

/**
 * A held send names its people only inside `intent` (issue #2730). Erasing
 * the diver takes back a hold that names them, by person or by seat, and
 * leaves another diver's hold alone.
 */
describe("erasing a diver with a send still held", () => {
  it("takes back the holds that name them and no other", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const seats = await db
      .select({ id: bookings.id, personId: bookings.personId, tripId: bookings.tripId })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(40);
    const erased = seats[0];
    const other = seats.find((seat) => seat.personId !== erased?.personId);
    if (!erased || !other) throw new Error("expected two seeded divers");

    const hold = (payload: Parameters<typeof holdSend>[1]["payload"]) =>
      holdSend(db, { shopId: shop.id, actorPersonId: owner.id, payload });
    const bySeat = await hold({
      kind: "waiver_send",
      bookingIds: [erased.id],
      channel: "email",
      surface: "roster",
    });
    const byPerson = await hold({
      kind: "waiver_send",
      bookingIds: [],
      personId: erased.personId,
      channel: "email",
      surface: "diver",
    });
    const theirs = await hold({
      kind: "waiver_send",
      bookingIds: [other.id],
      channel: "email",
      surface: "roster",
    });

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: erased.personId,
      actorPersonId: owner.id,
    });
    expect(result.ok).toBe(true);
    expect(await heldRows(db, { id: bySeat.id })).toEqual([]);
    expect(await heldRows(db, { id: byPerson.id })).toEqual([]);
    expect(await heldRows(db, { id: theirs.id })).toHaveLength(1);
  });
});
