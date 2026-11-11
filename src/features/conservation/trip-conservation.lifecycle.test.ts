import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { people, personRoles, tripStageEvents } from "../../db/schema/index";
import { tripDetailsAreEditable } from "../../db/trip-editability";
import { createTrip } from "../../db/trips";
import { DAY_MS, HOUR_MS, nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import {
  getTripConservationPanel,
  recordTripConservation,
  tripConservationFacts,
} from "./trip-conservation.store";

const ctx = fileScopedShopContext();
async function departure(dayCount = 1) {
  const { db, shop } = ctx;
  const now = nowDate();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("owner missing");
  const windows = Array.from({ length: dayCount }, (_, index) => ({
    dayNumber: index + 1,
    startsAt: new Date(now.getTime() - 2 * HOUR_MS + index * DAY_MS),
    endsAt: new Date(now.getTime() + 2 * HOUR_MS + index * DAY_MS),
  }));
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Early return cleanup",
    startsAt: windows[0].startsAt,
    endsAt: windows[dayCount - 1].endsAt,
    scheduleDays: windows,
    capacity: 6,
    plannedDives: 1,
  });
  if (!trip) throw new Error("trip missing");
  const input = {
    shopId: shop.id,
    tripId: trip.id,
    personId: owner.id,
    operation: "record" as const,
    fact: {
      kind: "litter_kg",
      quantity: 2,
      location: "Molasses Reef",
      note: "Collected on return",
    },
    now,
  };
  const home = (at = now) =>
    db.insert(tripStageEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      stage: "home",
      recordedAt: at,
      recordedByPersonId: owner.id,
    });
  return { db, shop, trip, input, home, now };
}

describe("conservation follows the final return, not only its scheduled time", () => {
  it("opens staff read/write and diver facts upon an early final-day Home", async () => {
    const { db, shop, trip, input, home, now } = await departure();
    expect(await recordTripConservation(db, input)).toEqual({ ok: false, reason: "not_returned" });
    await home();
    expect(await tripDetailsAreEditable(db, shop.id, trip.id, now)).toBe(false);
    expect(
      (await getTripConservationPanel(db, shop.id, trip.id, input.personId, now))?.editable,
    ).toBe(true);
    expect(await recordTripConservation(db, input)).toEqual({ ok: true });
    const facts = await tripConservationFacts(db, shop.id, trip.id, now);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject(input.fact);
    expect(facts[0]).not.toHaveProperty("recordedByPersonId");
  });

  it("waits through overnight Home and opens only on the final meeting day", async () => {
    const { db, shop, trip, input, home, now } = await departure(2);
    await home();
    expect(
      (await getTripConservationPanel(db, shop.id, trip.id, input.personId, now))?.editable,
    ).toBe(false);
    expect(await recordTripConservation(db, input)).toEqual({ ok: false, reason: "not_returned" });
    const finalDay = new Date(now.getTime() + DAY_MS);
    await home(finalDay);
    expect(
      (await getTripConservationPanel(db, shop.id, trip.id, input.personId, finalDay))?.editable,
    ).toBe(true);
    expect(await recordTripConservation(db, { ...input, now: finalDay })).toEqual({ ok: true });
    expect(await tripConservationFacts(db, shop.id, trip.id, finalDay)).toHaveLength(1);
  });
});
