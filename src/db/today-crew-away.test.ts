import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { acknowledgeCrewAway } from "./crew-away-acknowledgements";
import { saveCrewAvailabilityBlock } from "./crew-requests";
import { getTodayWork } from "./today";
import { createTrip, listStaff, setTripCrew } from "./trips";

/** Today's `crew_away` row (fourth review, item 12; issue #2678), apart from `today.test.ts`. */
const ctx = fileScopedShopContext();

/**
 * **Rostered and away, on Today** (fourth review, item 12). The staffing week
 * said Marcus was away the weekend he taught both Sunday sessions; the owner's
 * Today had no row. One `crew_away` row per departure ahead, naming the person
 * and the days, pointing at the crew editor, and kept open on that person's
 * own Today.
 */
describe("crew rostered while away", () => {
  it("raises one row on the departure, naming who and which days", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"))?.person;
    if (!instructor) throw new Error("seed instructor missing");
    const startsAt = new Date(nowMs() + 2 * 24 * 60 * 60_000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Away-day refresher",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60_000),
      capacity: 4,
      plannedDives: 1,
    });
    if (!trip) throw new Error("failed to create the departure");
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: instructor.id, tripRole: "instructor" },
      ]),
    ).toBe(true);
    const day = calendarDateInTimezone(startsAt, shop.timezone);
    const saved = await saveCrewAvailabilityBlock(db, {
      shopId: shop.id,
      personId: instructor.id,
      actorPersonId: instructor.id,
      canManageRoster: false,
      startsOn: day,
      endsOn: day,
      note: "Family trip",
    });
    expect(saved.ok).toBe(true);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const rows = work.actions.filter(
      (action) => action.kind === "crew_away" && action.departure?.tripId === trip.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toContain(`${instructor.fullName} is away`);
    expect(rows[0]?.href).toBe(`/shop/${shop.slug}/trips/${trip.id}?view=details#crew`);
    expect(rows[0]?.staffPersonId).toBe(instructor.id);
    // The week line counts the people these rows name (issue #2671).
    expect(rows[0]?.crewAway?.people).toEqual([
      { personId: instructor.id, fullName: instructor.fullName },
    ]);

    // "Working it anyway" (issue #2678) takes the row off Today.
    // Said by someone else, never the person about themself (security review).
    const owner = staff.find((entry) => entry.roles.includes("owner"))?.person;
    if (!owner) throw new Error("seeded owner missing");
    expect(
      await acknowledgeCrewAway(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: instructor.id,
        actorPersonId: owner.id,
      }),
    ).toBe("saved");
    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      after.actions.filter(
        (action) => action.kind === "crew_away" && action.departure?.tripId === trip.id,
      ),
    ).toEqual([]);

    // Not a course session, so it is not on "Your sessions"; the row is the
    // reader's own lead instead. A session the reader teaches carries the days.
    const own = await getTodayWork(db, shop.id, shop.slug, shop.timezone, undefined, instructor.id);
    expect(own.crewedTripIds).toContain(trip.id);
    for (const session of own.crewedSessions) {
      expect(Array.isArray(session.away)).toBe(true);
    }
  });
});
