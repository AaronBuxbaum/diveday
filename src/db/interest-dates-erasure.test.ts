import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createDiver } from "./divers";
import { addInterest, interestRow, ownerId } from "./interest-dates-fixtures";
import { askForDate, attachDateInterestsToDeparture } from "./interests";
import { interests, shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/** A shop with no date interests seeded, so nothing but the test's own is swept. */
async function emptyDateShop() {
  const { db, shop } = ctx;
  await db.delete(interests).where(and(eq(interests.shopId, shop.id), eq(interests.scope, "date")));
  return { db, shop };
}

/**
 * **Erasure of a date interest** (`scrubInterests`, ADR 20261017-one-interest-with-a-scope,
 * R4): blanked by person, then by email, then by phone, with its departure
 * children; never deleted, and never a bystander's.
 */
describe("erasing a diver who asked for a date", () => {
  async function erasable() {
    const { db, shop } = await emptyDateShop();
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Erasure Esme",
      email: "esme@example.com",
      phone: "+1 305 555 0424",
    });
    if (!diver) throw new Error("diver insert failed");
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed trip missing");
    return { db, shop, diver, trip, actor: await ownerId(db, shop.id) };
  }

  it("blanks the interest and the snapshot its child copied, and keeps the bystander's", async () => {
    const { db, shop, diver, trip, actor } = await erasable();
    // Reached by address only: no person link, so the child is person-less too.
    const byEmail = await addInterest(db, shop.id, {
      interest: "wrecks",
      name: "Esme",
      email: "ESME@example.com",
    });
    const bystander = await addInterest(db, shop.id, {
      interest: "reef",
      name: "Bystander Bo",
      email: "bo@example.com",
    });
    await attachDateInterestsToDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      interestIds: [byEmail, bystander],
      createdByPersonId: actor,
    });

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: actor,
    });
    if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

    expect(await interestRow(db, byEmail)).toMatchObject({
      name: null,
      email: null,
      phone: null,
      interest: "wrecks",
    });
    const [child] = await db.select().from(interests).where(eq(interests.parentInterestId, byEmail));
    expect(child).toMatchObject({ name: null, email: null, phone: null });
    expect(await interestRow(db, bystander)).toMatchObject({
      name: "Bystander Bo",
      email: "bo@example.com",
    });
    const [bystanderChild] = await db.select().from(interests).where(eq(interests.parentInterestId, bystander));
    expect(bystanderChild).toMatchObject({ name: "Bystander Bo", email: "bo@example.com" });
  });

  it("reaches an interest by the digits of a phone typed another way, and by the person link alone", async () => {
    const { db, shop, diver, actor } = await erasable();
    const byPhone = await addInterest(db, shop.id, {
      interest: "reef",
      phone: "+1 (305) 555-0424",
      name: "Esme",
    });
    const linked = await addInterest(db, shop.id, {
      interest: "night",
      email: "old-address@example.com",
      name: "Esme",
    });
    await db.update(interests).set({ personId: diver.id }).where(eq(interests.id, linked));

    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: actor });

    expect(await interestRow(db, byPhone)).toMatchObject({ name: null, phone: null });
    // Kept: it points at an already-erased row, and makes a replay reach it again.
    expect(await interestRow(db, linked)).toMatchObject({
      name: null,
      email: null,
      personId: diver.id,
    });
  });

  it("blanks the person-less departure child of a linked request, and leaves another shop's interest alone", async () => {
    const { db, shop, diver, trip, actor } = await erasable();
    const linkedInterest = (
      await askForDate(db, { shopId: shop.id, interest: "wrecks", email: "esme@example.com" })
    ).id;
    await attachDateInterestsToDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      interestIds: [linkedInterest],
      createdByPersonId: actor,
    });
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-erasure", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const theirs = await addInterest(db, rival.id, {
      interest: "theirs",
      email: "esme@example.com",
      name: "Esme",
    });

    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: actor });

    // The child never carries the person (security review of #2656, MAJOR 2):
    // it holds the request's snapshot, and the erasure blanks it with its parent.
    const children = await db.select().from(interests).where(eq(interests.parentInterestId, linkedInterest));
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ personId: null, name: null, email: null, phone: null });
    expect(await interestRow(db, linkedInterest)).toMatchObject({ name: null, email: null });
    expect(await interestRow(db, theirs)).toMatchObject({ name: "Esme", email: "esme@example.com" });
  });
});
