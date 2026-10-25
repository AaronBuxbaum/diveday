import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { captureDepartureBoatSafety, departureBoatSafetySnapshot } from "./boat-safety";
import { createBoat } from "./boats";
import type { AppDb } from "./client";
import { createGearItem } from "./gear";
import { recordCrewRollCall } from "./manifests";
import {
  boats,
  departureBoatSafetySnapshots,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  shops,
  tripAssignments,
  trips,
} from "./schema";
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
  it("keeps the checklist answer as it stood at the same instant as the notices (#2725)", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("no staff");
    const items = await db
      .insert(preDepartureChecklistItems)
      .values(
        ["#2725 oxygen aboard", "#2725 flares in date", "#2725 radio checked"].map(
          (label, sortOrder) => ({ shopId: shop.id, label, sortOrder: 1000 + sortOrder }),
        ),
      )
      .returning();
    const [oxygen, flares, radio] = items;
    if (!oxygen || !flares || !radio) throw new Error("items missing");
    const tap = (itemId: string, status: "checked" | "cleared", occurredAt: Date) => ({
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: itemId,
      recordedByPersonId: actor.person.id,
      status,
      occurredAt,
    });
    await db.insert(preDepartureCheckEvents).values([
      tap(oxygen.id, "checked", new Date(BEFORE.getTime() - 60_000)),
      // Checked, then taken back before the count: not checked then.
      tap(radio.id, "checked", new Date(BEFORE.getTime() - 120_000)),
      tap(radio.id, "cleared", new Date(BEFORE.getTime() - 30_000)),
      // Checked after the count: the record says what the crew had done then.
      tap(flares.id, "checked", new Date(BEFORE.getTime() + 60_000)),
    ]);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("captured");

    const snapshot = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    const ours = (snapshot?.checklist?.unchecked ?? []).filter((label) =>
      label.startsWith("#2725"),
    );
    expect(ours).toEqual(["#2725 flares in date", "#2725 radio checked"]);
    expect(snapshot?.checklist?.itemCount).toBeGreaterThanOrEqual(3);
  });

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

  it("keeps the boat's radio identity as the emergency card printed it (records review S1)", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Radio Hull", 12, null, {
      certifiedPassengers: null,
      certifiedTotalPersons: null,
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
      callSign: "WDM2201",
      mmsi: "338055502",
      workingChannel: "68",
    });
    const trip = await departure(db, shop.id, boat.id);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("captured");
    const radio = { callSign: "WDM2201", mmsi: "338055502", workingChannel: "68" };
    expect((await departureBoatSafetySnapshot(db, shop.id, trip.id))?.radio).toEqual(radio);

    // The channel changed after the boat left: the log still reads what sailed.
    await db.update(boats).set({ workingChannel: "72" }).where(eq(boats.id, boat.id));
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, LONG_AFTER)).toBe("sailed");
    expect((await departureBoatSafetySnapshot(db, shop.id, trip.id))?.radio).toEqual(radio);
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

  // Review D1 / records 1: the boat is judged at the tap, not at the sync.
  it("keeps an offline departure count synced long after sailing, as of the tap", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const now = nowMs();
    const startsAt = new Date(now - 4 * 3_600_000);
    const trip = await departure(db, shop.id, boat.id, startsAt);
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: staff.person.id });
    const tappedAt = new Date(startsAt.getTime() - 10 * 60_000);

    const synced = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: staff.person.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      source: "offline",
      clientEventId: "dddddddd-2300-4300-8300-dddddddddddd",
      offlineSnapshotSavedAt: new Date(startsAt.getTime() - 2 * 3_600_000),
      occurredAt: tappedAt,
    });
    expect(synced.ok).toBe(true);
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toMatchObject({
      boatName: "Snapshot Hull",
      capturedAt: tappedAt,
    });
  });

  it("never lets an older tap overwrite a newer one", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    const later = new Date(BEFORE.getTime() + 30 * 60_000);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, later)).toBe("captured");
    await db.update(boats).set({ name: "Renamed Hull" }).where(eq(boats.id, boat.id));
    // An offline tap from before the live one arrives second.
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("kept_newer");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toMatchObject({
      boatName: "Snapshot Hull",
      capturedAt: later,
    });
  });

  it("keeps nothing for a deleted hull", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    await db.update(boats).set({ deletedAt: BEFORE }).where(eq(boats.id, boat.id));
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE)).toBe("no_boat");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toBeNull();
  });

  it("keeps existing evidence but takes no fresh snapshot from a deleted hull", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE);
    const before = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    await db.update(boats).set({ deletedAt: BEFORE }).where(eq(boats.id, boat.id));
    expect(
      await captureDepartureBoatSafety(db, shop.id, trip.id, new Date(BEFORE.getTime() + 60_000)),
    ).toBe("no_boat");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
  });

  it("preserves evidence with unknown departure-time provenance instead of guessing it may be rewritten", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE);
    await db
      .update(departureBoatSafetySnapshots)
      .set({ departureStartsAt: null })
      .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
    const before = await db
      .select()
      .from(departureBoatSafetySnapshots)
      .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
    await db.update(boats).set({ inspectionDueOn: "2027-10-01" }).where(eq(boats.id, boat.id));
    expect(
      await captureDepartureBoatSafety(db, shop.id, trip.id, new Date(BEFORE.getTime() + 60_000)),
    ).toBe("kept_unknown");
    expect(
      await db
        .select()
        .from(departureBoatSafetySnapshots)
        .where(eq(departureBoatSafetySnapshots.tripId, trip.id)),
    ).toEqual(before);
  });

  it("names the hull it kept, so a swapped boat can be told apart", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const trip = await departure(db, shop.id, boat.id);
    await captureDepartureBoatSafety(db, shop.id, trip.id, BEFORE);
    expect((await departureBoatSafetySnapshot(db, shop.id, trip.id))?.boatId).toBe(boat.id);
  });

  it("never rewrites kept sailed evidence with a later offline tap against a changed hull", async () => {
    const { db, shop } = ctx;
    const boat = await paperedBoat(db, shop.id);
    const replacement = await createBoat(db, shop.id, "Replacement Hull", 12);
    const startsAt = new Date(nowMs() - 4 * 3_600_000);
    const trip = await departure(db, shop.id, boat.id, startsAt);
    const firstTap = new Date(startsAt.getTime() - 10 * 60_000);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, firstTap)).toBe("captured");
    const before = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    await db.update(trips).set({ boatId: replacement.id }).where(eq(trips.id, trip.id));
    expect(
      await captureDepartureBoatSafety(db, shop.id, trip.id, new Date(firstTap.getTime() + 60_000)),
    ).toBe("sailed");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
  });
});
