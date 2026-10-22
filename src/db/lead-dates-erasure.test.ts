import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createDiver } from "./divers";
import { addLead, leadRow, ownerId } from "./lead-dates-fixtures";
import { askForDate, attachDateLeadsToDeparture } from "./leads";
import { leads, shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/** A shop with no date leads seeded, so nothing but the test's own is swept. */
async function emptyDateShop() {
  const { db, shop } = ctx;
  await db.delete(leads).where(and(eq(leads.shopId, shop.id), eq(leads.scope, "date")));
  return { db, shop };
}

/**
 * **Erasure of a date lead** (`scrubLeads`, ADR 20261017-one-lead-with-a-scope,
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

  it("blanks the lead and the snapshot its child copied, and keeps the bystander's", async () => {
    const { db, shop, diver, trip, actor } = await erasable();
    // Reached by address only: no person link, so the child is person-less too.
    const byEmail = await addLead(db, shop.id, {
      interest: "wrecks",
      name: "Esme",
      email: "ESME@example.com",
    });
    const bystander = await addLead(db, shop.id, {
      interest: "reef",
      name: "Bystander Bo",
      email: "bo@example.com",
    });
    await attachDateLeadsToDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      leadIds: [byEmail, bystander],
      createdByPersonId: actor,
    });

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: actor,
    });
    if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

    expect(await leadRow(db, byEmail)).toMatchObject({
      name: null,
      email: null,
      phone: null,
      interest: "wrecks",
    });
    const [child] = await db.select().from(leads).where(eq(leads.parentLeadId, byEmail));
    expect(child).toMatchObject({ name: null, email: null, phone: null });
    expect(await leadRow(db, bystander)).toMatchObject({
      name: "Bystander Bo",
      email: "bo@example.com",
    });
    const [bystanderChild] = await db.select().from(leads).where(eq(leads.parentLeadId, bystander));
    expect(bystanderChild).toMatchObject({ name: "Bystander Bo", email: "bo@example.com" });
  });

  it("reaches a lead by the digits of a phone typed another way, and by the person link alone", async () => {
    const { db, shop, diver, actor } = await erasable();
    const byPhone = await addLead(db, shop.id, {
      interest: "reef",
      phone: "+1 (305) 555-0424",
      name: "Esme",
    });
    const linked = await addLead(db, shop.id, {
      interest: "night",
      email: "old-address@example.com",
      name: "Esme",
    });
    await db.update(leads).set({ personId: diver.id }).where(eq(leads.id, linked));

    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: actor });

    expect(await leadRow(db, byPhone)).toMatchObject({ name: null, phone: null });
    // Kept: it points at an already-erased row, and makes a replay reach it again.
    expect(await leadRow(db, linked)).toMatchObject({
      name: null,
      email: null,
      personId: diver.id,
    });
  });

  it("deletes a departure child that carries the person, and leaves another shop's lead alone", async () => {
    const { db, shop, diver, trip, actor } = await erasable();
    const linkedLead = (
      await askForDate(db, { shopId: shop.id, interest: "wrecks", email: "esme@example.com" })
    ).id;
    await attachDateLeadsToDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      leadIds: [linkedLead],
      createdByPersonId: actor,
    });
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-erasure", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const theirs = await addLead(db, rival.id, {
      interest: "theirs",
      email: "esme@example.com",
      name: "Esme",
    });

    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: actor });

    expect(await db.select().from(leads).where(eq(leads.parentLeadId, linkedLead))).toHaveLength(0);
    expect(await leadRow(db, linkedLead)).toMatchObject({ name: null, email: null });
    expect(await leadRow(db, theirs)).toMatchObject({ name: "Esme", email: "esme@example.com" });
  });
});
