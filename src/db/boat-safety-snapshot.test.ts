import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { captureDepartureBoatSafety, departureBoatSafetySnapshot } from "./boat-safety";
import { createBoat } from "./boats";
import type { AppDb } from "./client";
import { createGearItem } from "./gear";
import { recordCrewRollCall } from "./manifests";
import { boats, departureBoatSafetySnapshots, shops, tripAssignments, trips } from "./schema";
import { listStaff } from "./trips";

/**
 * **The departure log keeps the boat as it left** (#2300). The snapshot is
 * rewritten on every departure-checkpoint write until the boat has sailed,
 * then never again, so a paper renewed or a kit unit fixed the day after
 * cannot rewrite what the crew had in front of them.
 */
const ctx = fileScopedShopContext();

const BEFORE = new Date("2026-10-09T12:00:00Z");
const STARTS = new Date("2026-10-09T13:00:00Z");
const LONG_AFTER = new Date("2026-10-10T12:00:00Z");

async function departure(db: AppDb, shopId: string, boatId: string | null, startsAt = STARTS) {
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      boatId,
      title: `Snapshot ${startsAt.toISOString()}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 10,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  return trip;
}

async function paperedBoat(db: AppDb, shopId: string) {
  return createBoat(db, shopId, "Snapshot Hull", 12, null, {
    certifiedPassengers: 12,
    certifiedTotalPersons: 15,
    coiExpiresOn: "2027-05-01",
    // Lapsed before the departure day: the notice the log must keep.
    inspectionDueOn: "2026-10-01",
    registrationExpiresOn: null,
    insuranceExpiresOn: null,
  });
}

describe("captureDepartureBoatSafety", () => {
  it("keeps the papers verbatim and the notices judged on the departure's own day", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("captured");

    const snapshot = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(snapshot).toMatchObject({
      boatName: "Snapshot Hull",
      judgedOn: "2026-10-09",
      capturedAt: BEFORE,
      papers: {
        certifiedPassengers: 12,
        certifiedTotalPersons: 15,
        coiExpiresOn: "2027-05-01",
        inspectionDueOn: "2026-10-01",
        registrationExpiresOn: null,
        insuranceExpiresOn: null,
      },
    });
    expect(snapshot?.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "paper", paper: "inspection", expired: true }),
      ]),
    );
    // The head count is the roll call's record, never the snapshot's.
    expect(snapshot?.notices.map((notice) => notice.code)).not.toContain("over_certificate");
    expect(snapshot?.notices.map((notice) => notice.code)).not.toContain("over_total_persons");
  });

  it("rewrites the snapshot before sailing, and freezes it once the boat has sailed", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("captured");

    // Renewed at the dock before the boat left: the log reads the renewal.
    await db.update(boats).set({ inspectionDueOn: "2027-10-01" }).where(eq(boats.id, boat.id));
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("captured");
    const renewed = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(renewed?.papers.inspectionDueOn).toBe("2027-10-01");

    // A day later, the papers lapse again; a late (offline) departure write
    // must not rewrite what the boat sailed with.
    await db.update(boats).set({ inspectionDueOn: "2026-01-01" }).where(eq(boats.id, boat.id));
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, LONG_AFTER)).toBe("sailed");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(renewed);
    const rows = await db
      .select()
      .from(departureBoatSafetySnapshots)
      .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
    expect(rows).toHaveLength(1);
  });

  it("keeps a missing life-safety kit unit as a notice", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const o2 = await createGearItem(db, {
      shopId: shop.id,
      kind: "o2_kit",
      label: "O2 elsewhere",
      aboardBoatId: null,
    });
    if (!o2.ok) throw new Error(o2.reason);
    const trip = await departure(db, shop.id, boat.id);
    await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE);
    const snapshot = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(snapshot?.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "kit_missing", kind: "o2_kit" })]),
    );
  });

  it("writes nothing for a departure with no boat, or one of another shop", async () => {
    const { db, shop } = ctx;
    const boatless = await departure(db, shop.id, null);
    expect(await captureDepartureBoatSafety(db, shop.id, boatless.id, BEFORE)).toBe("no_boat");
    expect(await departureBoatSafetySnapshot(db, shop.id, boatless.id)).toBeNull();

    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-snapshot", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("other shop insert failed");
    expect(await captureDepartureBoatSafety(db, other.id, trip.id, BEFORE)).toBe("no_boat");
    expect(await departureBoatSafetySnapshot(db, other.id, trip.id)).toBeNull();
  });

  it("is written by a departure crew count, and not by an after-dive one", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    // Departs later today on the live clock, so it has not sailed.
    const trip = await departure(db, shop.id, boat.id, new Date(nowMs() + 3 * 3_600_000));
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: staff.person.id });

    const afterDive = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: staff.person.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    expect(afterDive.ok).toBe(true);
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toBeNull();

    const atDeparture = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: staff.person.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });
    expect(atDeparture.ok).toBe(true);
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toMatchObject({
      boatName: "Snapshot Hull",
    });
  });
});
