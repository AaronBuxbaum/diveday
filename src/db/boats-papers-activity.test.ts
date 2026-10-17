import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBoat, updateBoatWithinCertificate } from "./boats";
import { activityEvents } from "./schema";
import { listStaff } from "./trips";

/**
 * **Who changed a boat's certificate or papers, and from what** (records
 * review 2). The certificate limits and paper dates drive the manifest's
 * danger lines, so every change to one leaves a line naming the staffer, the
 * field and both values. A save that changes none of them leaves nothing.
 */
const ctx = fileScopedShopContext();

const NOW = new Date("2030-05-01T12:00:00.000Z");
const CLEAR = {
  certifiedPassengers: null,
  certifiedTotalPersons: null,
  coiExpiresOn: null,
  inspectionDueOn: null,
  registrationExpiresOn: null,
  insuranceExpiresOn: null,
};

async function lines(shopId: string) {
  const rows = await ctx.db
    .select({ params: activityEvents.params })
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, shopId), eq(activityEvents.code, "boat_papers_changed")))
    .orderBy(activityEvents.seq);
  return rows.map((row) => row.params);
}

async function actor() {
  const [staff] = await listStaff(ctx.db, ctx.shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { id: staff.person.id, name: staff.person.fullName };
}

describe("boat papers activity", () => {
  it("names each changed field with its old and new value, and the staffer", async () => {
    const { db, shop } = ctx;
    const staff = await actor();
    const boat = await createBoat(db, shop.id, "Logged Hull", 10, null, {
      ...CLEAR,
      certifiedPassengers: 12,
      inspectionDueOn: "2030-06-01",
    });
    const saved = await updateBoatWithinCertificate(db, {
      shopId: shop.id,
      boatId: boat.id,
      name: "Logged Hull",
      capacity: 10,
      description: null,
      papers: { ...CLEAR, certifiedPassengers: 12, inspectionDueOn: "2031-06-01" },
      timeZone: "America/New_York",
      now: NOW,
      actorPersonId: staff.id,
    });
    expect(saved.ok).toBe(true);
    expect(await lines(shop.id)).toEqual([
      {
        actor: staff.name,
        boat: "Logged Hull",
        field: "inspectionDueOn",
        from: "2030-06-01",
        to: "2031-06-01",
      },
    ]);
  });

  it("says a value was cleared, and writes nothing for a save that changes no paper", async () => {
    const { db, shop } = ctx;
    const staff = await actor();
    const boat = await createBoat(db, shop.id, "Quiet Hull", 10, null, {
      ...CLEAR,
      coiExpiresOn: "2031-01-01",
    });
    const save = (coiExpiresOn: string | null, capacity: number) =>
      updateBoatWithinCertificate(db, {
        shopId: shop.id,
        boatId: boat.id,
        name: "Quiet Hull",
        capacity,
        description: null,
        papers: { ...CLEAR, coiExpiresOn },
        timeZone: "America/New_York",
        now: NOW,
        actorPersonId: staff.id,
      });
    await save("2031-01-01", 8);
    expect(await lines(shop.id)).toEqual([]);
    await save(null, 8);
    expect(await lines(shop.id)).toEqual([
      {
        actor: staff.name,
        boat: "Quiet Hull",
        field: "coiExpiresOn",
        from: "2031-01-01",
        to: "none",
      },
    ]);
  });

  it("writes nothing when the save is refused", async () => {
    const { db, shop } = ctx;
    const staff = await actor();
    const boat = await createBoat(db, shop.id, "Refused Hull", 10);
    const saved = await updateBoatWithinCertificate(db, {
      shopId: shop.id,
      boatId: boat.id,
      name: "Refused Hull",
      capacity: 20,
      description: null,
      papers: { ...CLEAR, certifiedTotalPersons: 12 },
      timeZone: "America/New_York",
      now: NOW,
      actorPersonId: staff.id,
    });
    expect(saved.ok).toBe(false);
    expect(await lines(shop.id)).toEqual([]);
  });

  it("names the papers a new boat starts with", async () => {
    const { db, shop } = ctx;
    const staff = await actor();
    await createBoat(
      db,
      shop.id,
      "New Hull",
      10,
      null,
      { ...CLEAR, certifiedTotalPersons: 14 },
      staff.id,
    );
    expect(await lines(shop.id)).toEqual([
      {
        actor: staff.name,
        boat: "New Hull",
        field: "certifiedTotalPersons",
        from: "none",
        to: "14",
      },
    ]);
  });
});
