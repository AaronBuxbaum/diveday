import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteStaffShift } from "@/features/crew-and-boats/staffing/store";
import {
  insertShop,
  person,
  rentalShop,
  staffer,
} from "../test/substrate-fixtures/db/gear-counter-rentals-test-fixtures";
import { softDeleteCard } from "./card-delete";
import { deleteChecklistItem, reorderChecklistItems } from "./pre-departure-check";
import { cards, preDepartureChecklistItems, staffShifts } from "./schema";

/**
 * A staffer who names another shop's row id changes nothing there. These
 * writes take ids from a form, so the shop in the `where` is the only fence
 * (fixit auth3 audit: every site read was scoped; these pin the ones that had
 * no cross-shop test of their own).
 */
async function twoShops() {
  const { db, shop: mine } = await rentalShop("mine-shop");
  const theirs = await insertShop(db, "their-shop");
  return { db, mine, theirs, outsider: await staffer(db, mine.id) };
}

describe("ids from another shop are refused", () => {
  it("does not reorder or delete another shop's checklist items", async () => {
    const { db, theirs, mine, outsider } = await twoShops();
    const [item] = await db
      .insert(preDepartureChecklistItems)
      .values({ shopId: theirs.id, label: "Tank pressure", sortOrder: 4 })
      .returning();
    if (!item) throw new Error("item insert failed");

    await reorderChecklistItems(db, {
      shopId: mine.id,
      personId: outsider.id,
      orderedIds: [item.id],
    });
    await deleteChecklistItem(db, { shopId: mine.id, personId: outsider.id, itemId: item.id });

    const [after] = await db
      .select()
      .from(preDepartureChecklistItems)
      .where(eq(preDepartureChecklistItems.id, item.id));
    expect(after?.sortOrder).toBe(4);
    expect(after?.deletedAt).toBeNull();
  });

  it("does not delete another shop's staff shift", async () => {
    const { db, theirs, mine } = await twoShops();
    const theirStaff = await staffer(db, theirs.id);
    const [shift] = await db
      .insert(staffShifts)
      .values({
        shopId: theirs.id,
        personId: theirStaff.id,
        startsAt: new Date("2026-10-08T12:00:00Z"),
        endsAt: new Date("2026-10-08T20:00:00Z"),
      })
      .returning();
    if (!shift) throw new Error("shift insert failed");

    expect(await deleteStaffShift(db, mine.id, shift.id)).toBe(false);
    expect(await db.select().from(staffShifts).where(eq(staffShifts.id, shift.id))).toHaveLength(1);
  });

  it("does not archive another shop's card", async () => {
    const { db, theirs, mine, outsider } = await twoShops();
    const diver = await person(db, theirs.id, "Their Diver");
    const [card] = await db.select().from(cards).where(eq(cards.personId, diver.id));
    if (!card) throw new Error("card missing");

    const archived = await softDeleteCard(db, {
      kind: "level",
      shopId: mine.id,
      certificationId: card.id,
      deletedByPersonId: outsider.id,
    });

    expect(archived).toBe(false);
    const [after] = await db.select().from(cards).where(eq(cards.id, card.id));
    expect(after?.deletedAt).toBeNull();
  });
});
