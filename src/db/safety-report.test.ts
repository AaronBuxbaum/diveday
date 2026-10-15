import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getSafetyMonth } from "./safety-report";
import { activityEvents, tripAssignments, trips } from "./schema";
import { listStaff } from "./trips";

// The demo shop with its sailed history, one rolled-back transaction per test.
const ctx = fileScopedShopContext({ history: true });

const OTHER_SHOP = "99999999-8888-4777-8666-555555555555";
const FAR_PAST = new Date("2000-01-01T00:00:00Z");
const FAR_FUTURE = new Date("2100-01-01T00:00:00Z");

describe("getSafetyMonth", () => {
  it("accounts for every departure that came home, closed or not", async () => {
    const { db, shop } = ctx;
    const month = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(month.departuresBack).toBeGreaterThan(0);
    expect(month.rollCallsClosed + month.openRollCalls.length).toBe(month.departuresBack);
  });

  it("counts a card check written past, and only inside the period", async () => {
    const { db, shop } = ctx;
    const owner = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
    if (!owner) throw new Error("expected an owner");
    const before = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    const params = {
      actor: owner.person.fullName,
      diver: "A diver",
      from: "snorkeler",
      type: "diver",
      certCheck: "overridden",
      cleared: "",
    };
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        actorPersonId: owner.person.id,
        code: "participant_type_changed",
        params,
        occurredAt: new Date("2026-06-15T12:00:00Z"),
      },
      {
        shopId: shop.id,
        actorPersonId: owner.person.id,
        code: "participant_type_changed",
        params: { ...params, certCheck: "cleared" },
        occurredAt: new Date("2026-06-15T12:00:00Z"),
      },
    ]);
    const after = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(after.certOverrides).toBe(before.certOverrides + 1);
    const july = await getSafetyMonth(
      db,
      shop.id,
      new Date("2026-07-01T00:00:00Z"),
      new Date("2026-08-01T00:00:00Z"),
      shop.timezone,
    );
    expect(july.certOverrides).toBe(0);
  });

  it("names a departure that came home with nobody on its crew (fourth review, item 13)", async () => {
    const { db, shop } = ctx;
    const before = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    // The demo's sailed boats all carry crew now, so its record reads clean.
    expect(before.noCrewDepartures).toEqual([]);
    const [crewed] = await db
      .select({ tripId: tripAssignments.tripId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(
        and(
          eq(trips.shopId, shop.id),
          eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
        ),
      )
      .limit(1);
    if (!crewed) throw new Error("expected a crewed history boat");
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, crewed.tripId));
    const after = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(after.noCrewDepartures.map((row) => row.tripId)).toEqual([crewed.tripId]);
    // Review F1: "sailed" is a boat's word; the same day from the beach is not listed.
    await db.update(trips).set({ diveMode: "shore" }).where(eq(trips.id, crewed.tripId));
    const ashore = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(ashore.noCrewDepartures).toEqual([]);
  });

  it("reads nothing of another shop's", async () => {
    const { db, shop } = ctx;
    const month = await getSafetyMonth(db, OTHER_SHOP, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(month).toMatchObject({ departuresBack: 0, certOverrides: 0, crewSailings: 0 });
  });
});
