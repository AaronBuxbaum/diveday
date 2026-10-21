import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { captureDepartureBoatSafety, departureBoatSafetySnapshot } from "./boat-safety";
import { deleteBoat } from "./boats";
import { activityEvents, boats, departureBoatSafetySnapshots, trips } from "./schema";
import { boatTripFixture, tripBoatPatch } from "./trip-boat-test-fixtures";
import { getTripWithBooked, listStaff, updateTrip } from "./trips";

const ctx = fileScopedShopContext();

describe("boat changes and retained departure safety evidence", () => {
  const boatTrip = () => boatTripFixture(ctx.db, ctx.shop);
  const patch = tripBoatPatch;

  it("rewrites an existing unsailed safety snapshot for the replacement hull", async () => {
    const { db, shop, trip, hull, spare } = await boatTrip();
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id)).toBe("captured");
    const before = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(before?.boatId).toBe(hull.id);
    advanceClock();
    const changedAt = nowDate();
    expect((await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: spare.id })).ok).toBe(
      true,
    );
    const after = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(after).toMatchObject({ boatId: spare.id, boatName: spare.name, capturedAt: changedAt });
    // A delayed tap from the old boat cannot restore its earlier evidence.
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, before?.capturedAt)).toBe(
      "kept_newer",
    );
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(after);
  });

  it("records hull names and the saved outcome only for successful hull changes", async () => {
    const { db, shop, trip, hull, spare } = await boatTrip();
    const actor = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
    if (!actor) throw new Error("owner missing");
    // A hull may literally be named none: presence is a separate coded fact.
    await db.update(boats).set({ name: "none" }).where(eq(boats.id, hull.id));
    await captureDepartureBoatSafety(db, shop.id, trip.id);
    const edit = { ...patch(trip), changeActorPersonId: actor.person.id };
    await updateTrip(db, shop.id, trip.id, { ...edit, boatId: spare.id });
    await updateTrip(db, shop.id, trip.id, { ...edit, boatId: spare.id });
    const events = () =>
      db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.shopId, shop.id),
            eq(activityEvents.tripId, trip.id),
            eq(activityEvents.code, "departure_boat_changed"),
          ),
        );
    expect(await events()).toHaveLength(1);
    expect((await events())[0]?.params).toMatchObject({
      fromBoat: "none",
      toBoat: spare.name,
      hasFromBoat: "yes",
      hasToBoat: "yes",
      snapshot: "refreshed",
    });
    await deleteBoat(db, shop.id, hull.id);
    expect((await updateTrip(db, shop.id, trip.id, { ...edit, boatId: hull.id })).ok).toBe(false);
    expect(await events()).toHaveLength(1);
    await updateTrip(db, shop.id, trip.id, { ...edit, boatId: null });
    expect(await events()).toHaveLength(2);
    expect(
      (await events()).find((event) => (event.params as { hasToBoat?: string }).hasToBoat === "no")
        ?.params,
    ).toMatchObject({
      fromBoat: spare.name,
      toBoat: "",
      hasFromBoat: "yes",
      hasToBoat: "no",
      snapshot: "kept",
    });
  });

  it("keeps a sailed snapshot exactly, even when a swap also moves the departure into the future", async () => {
    const { db, shop, trip, hull, spare } = await boatTrip();
    const startsAt = new Date(nowDate().getTime() - 3 * 3_600_000);
    await db.update(trips).set({ startsAt, revision: 1 }).where(eq(trips.id, trip.id));
    const tappedAt = new Date(startsAt.getTime() - 60_000);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id, tappedAt)).toBe("captured");
    const before = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    const rawBefore = await db
      .select()
      .from(departureBoatSafetySnapshots)
      .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: spare.id });
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
    expect(
      await db
        .select()
        .from(departureBoatSafetySnapshots)
        .where(eq(departureBoatSafetySnapshots.tripId, trip.id)),
    ).toEqual(rawBefore);
    // The next ordinary departure count sees the moved start time too.
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id)).toBe("sailed");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: hull.id });
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id)).toBe("sailed");
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
  });

  it("rebinds an unsailed reschedule so passing its old time does not freeze the new departure", async () => {
    const { db, shop, trip } = await boatTrip();
    const originalStart = new Date(nowDate().getTime() + 3_600_000);
    await updateTrip(db, shop.id, trip.id, {
      ...patch(trip),
      startsAt: originalStart,
      endsAt: new Date(originalStart.getTime() + 4 * 3_600_000),
    });
    await captureDepartureBoatSafety(db, shop.id, trip.id);
    const futureStart = new Date(nowDate().getTime() + 24 * 3_600_000);
    await updateTrip(db, shop.id, trip.id, {
      ...patch(trip),
      startsAt: futureStart,
      endsAt: new Date(futureStart.getTime() + 4 * 3_600_000),
    });
    const [row] = await db
      .select()
      .from(departureBoatSafetySnapshots)
      .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
    expect(row?.departureStartsAt).toEqual(futureStart);
    advanceClock(3 * 3_600_000);
    expect(await captureDepartureBoatSafety(db, shop.id, trip.id)).toBe("captured");
  });

  it("rolls back the boat, refreshed snapshot and activity when a later schedule write fails", async () => {
    const { db, shop, trip, hull, spare } = await boatTrip();
    const actor = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
    if (!actor) throw new Error("owner missing");
    await captureDepartureBoatSafety(db, shop.id, trip.id);
    const before = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    advanceClock();
    // The invalid schedule-day write runs after both recapture and activity.
    // updateTrip owns its transaction, including the failing schedule write.
    await expect(
      updateTrip(db, shop.id, trip.id, {
        ...patch(trip),
        boatId: spare.id,
        changeActorPersonId: actor.person.id,
        scheduleDays: [{ dayNumber: 1, startsAt: trip.startsAt, endsAt: trip.startsAt }],
      }),
    ).rejects.toThrow();
    expect((await getTripWithBooked(db, shop.id, trip.id))?.boatId).toBe(hull.id);
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.tripId, trip.id),
            eq(activityEvents.code, "departure_boat_changed"),
          ),
        ),
    ).toEqual([]);
  });

  it("keeps snapshot evidence on refused and cross-tenant edits and on clearing the hull", async () => {
    const { db, shop, trip, spare } = await boatTrip();
    await captureDepartureBoatSafety(db, shop.id, trip.id);
    const before = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    await deleteBoat(db, shop.id, spare.id);
    expect(
      await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: spare.id }),
    ).toMatchObject({ ok: false });
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
    expect(
      await updateTrip(db, "00000000-0000-4000-8000-000000000001", trip.id, {
        ...patch(trip),
        boatId: null,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: null });
    expect(await departureBoatSafetySnapshot(db, shop.id, trip.id)).toEqual(before);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.boatId).toBeNull();
  });
});
