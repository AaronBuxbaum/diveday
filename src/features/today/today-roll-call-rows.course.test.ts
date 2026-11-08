import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tripScheduleDays, trips } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import {
  boardAtDeparture,
  HOUR,
  returnedTrip,
} from "../../test/substrate-fixtures/db/roll-call-test-fixtures";
import { shopClock } from "../shop-clock/rules";
import { getTodayWork } from "./today-reader";

const EN = staffTranslator("en-US");
const ctx = fileScopedShopContext();

/**
 * #2557 review (dock S2): a course may meet a fortnight apart, past the
 * boats-out read's fourteen-day look-back from the run's start. The horizon
 * reads the course by its meeting days, so the row still comes; this keeps it so.
 */
describe("a blocked diver aboard a course that meets a fortnight apart", () => {
  it("is raised on the course's last day, fifteen days after day one", async () => {
    const { db, shop } = ctx;
    // Due back half an hour ago, inside the return buffer, nobody tapping Home.
    const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
      endedHoursAgo: 0.5,
      divers: 1,
      title: "Blocked Aboard, a fortnight on — Molasses",
    });
    await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
    const dayOneStart = new Date(trip.startsAt.getTime() - 15 * 24 * HOUR);
    await db.update(trips).set({ startsAt: dayOneStart }).where(eq(trips.id, trip.id));
    await db.insert(tripScheduleDays).values([
      {
        tripId: trip.id,
        dayNumber: 1,
        startsAt: dayOneStart,
        endsAt: new Date(dayOneStart.getTime() + 4 * HOUR),
      },
      { tripId: trip.id, dayNumber: 2, startsAt: trip.startsAt, endsAt: trip.endsAt },
    ]);
    const work = await getTodayWork(db, shop.id, shop.slug, shopClock(shop), undefined, EN);
    expect(work.outTripIds).toContain(trip.id);
    expect(
      work.actions
        .filter((action) => action.departure?.tripId === trip.id)
        .map((action) => action.kind),
    ).toContain("blocked_aboard");
  });
});
