import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people } from "./schema";
import { createTrip, getTripRoster } from "./trips";
import { listTripWaiverStatuses } from "./waivers-trip-status";

const ctx = fileScopedShopContext();

describe("listTripWaiverStatuses row order (issue #1753)", () => {
  /**
   * **The two readers of one roster answer in the same order.**
   *
   * `getTripRoster` and `listTripsWaiverStatuses` walk the same seats with the
   * same filter, and this one used to stop at `asc(bookings.id)` — a
   * `defaultRandom()` uuid — while the roster had moved on to
   * `asc(people.full_name)`. Nothing renders this array directly today (every
   * consumer re-keys it by booking id), so the cost was not a visible list: it
   * was that the documented order was unpredictable, and that whoever next
   * rendered these rows would have got a different order from the manifest
   * beside it.
   *
   * The tie is forced with `created_at`, and the **higher** uuid is given to
   * the diver who must sort first, so the old clause answered the exact
   * opposite every time rather than half the time.
   */
  it("breaks a shared-instant tie on the diver's name, and agrees with getTripRoster", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Waiver Order Reef",
      startsAt: new Date("2026-08-02T13:00:00.000Z"),
      endsAt: new Date("2026-08-02T17:00:00.000Z"),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip insert failed");
    const together = new Date("2026-07-21T13:30:00.000Z");
    const seat = async (fullName: string, id: string) => {
      const [person] = await db.insert(people).values({ shopId: shop.id, fullName }).returning();
      if (!person) throw new Error("test person insert failed");
      await db.insert(bookings).values({
        bookedAs: "diver",
        id,
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        createdAt: together,
      });
    };
    // "Alpha Nord" must come first, so it gets the higher uuid.
    await seat("Zulu Mbeki", "00000000-0000-4000-8000-000000000001");
    await seat("Alpha Nord", "00000000-0000-4000-8000-000000000002");

    const statuses = await listTripWaiverStatuses(db, shop.id, trip.id);
    expect(statuses.map((row) => row.person.fullName)).toEqual(["Alpha Nord", "Zulu Mbeki"]);
    // …and the roster it sits beside gives the identical order.
    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(statuses.map((row) => row.booking.id)).toEqual(roster.map((row) => row.booking.id));
  });
});
