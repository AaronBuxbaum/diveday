import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { similarDepartures } from "@/lib/similar-departures";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { createDiver } from "./divers";
import { certifications, diveSites, tripDives } from "./schema";
import { createTrip } from "./trips";
import { createTripSeries } from "./trips-series";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

describe("the run's next date is gated at the sale like a direct visit (issue #2680)", () => {
  // A full departure offers its run's next date (`same_run`) on series
  // membership alone, and a series date can be re-pointed on its own at a
  // deeper site. The offer is a link, not a pass: the sale on that date runs
  // the same `decideTripAdmission` a diver reaching it directly meets.
  const SAT = 6;

  async function duane() {
    const { db, shop } = ctx;
    const [site] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, "USCGC Duane")))
      .limit(1);
    if (!site) throw new Error("seeded USCGC Duane site missing");
    return site;
  }

  async function openWaterDiver(email: string) {
    const { db, shop } = ctx;
    const person = await createDiver(db, { shopId: shop.id, fullName: "Tamsin Reef", email });
    if (!person) throw new Error("diver setup failed");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: person.id,
      agency: "padi",
      level: "open_water",
      identifier: `C-${email}`,
      status: "verified",
    });
    return person;
  }

  function publicSeat(tripId: string, email: string) {
    return createBooking(ctx.db, {
      actor: "public",
      shopId: ctx.shop.id,
      tripId,
      fullName: "Tamsin Reef",
      email,
    });
  }

  it("refuses the edited next date exactly as it refuses a one-off trip to the same site", async () => {
    const { db, shop } = ctx;
    const site = await duane();
    const series = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday Shallows",
      capacity: 12,
      plannedDives: 1,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([SAT]),
      anchorDate: "2030-09-07",
      endsOn: "2030-09-28",
      timeZone: "America/New_York",
      template: {
        startsAt: new Date("2030-09-07T11:00:00.000Z"),
        endsAt: new Date("2030-09-07T15:00:00.000Z"),
      },
    });
    if (!series) throw new Error("series not created");
    const [full, edited, sibling] = series.trips.sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    if (!full || !edited || !sibling) throw new Error("expected three dates");
    // One date of the run, edited on its own to the deep wreck.
    await db
      .update(tripDives)
      .set({ diveSiteId: site.id })
      .where(and(eq(tripDives.tripId, edited.id), eq(tripDives.diveNumber, 1)));

    // The full Saturday offers the edited one as its run's next date.
    const offered = similarDepartures({
      full: {
        tripId: full.id,
        courseId: null,
        diveSiteId: null,
        seriesId: full.seriesId,
        startsAt: full.startsAt,
      },
      candidates: [edited, sibling].map((trip) => ({
        id: trip.id,
        title: trip.title,
        startsAt: trip.startsAt,
        courseId: null,
        diveSiteId: trip.id === edited.id ? site.id : null,
        seriesId: trip.seriesId,
      })),
    });
    expect(offered[0]).toMatchObject({ tripId: edited.id, reason: "same_run" });

    // A one-off departure to the same site, reached directly.
    const direct = await createTrip(db, {
      shopId: shop.id,
      title: "Duane, one-off",
      dives: [{ diveSiteId: site.id }],
      startsAt: new Date("2030-09-14T11:00:00.000Z"),
      endsAt: new Date("2030-09-14T15:00:00.000Z"),
      capacity: 12,
      plannedDives: 1,
    });
    if (!direct) throw new Error("one-off trip not created");

    await openWaterDiver("run-next@example.com");
    await openWaterDiver("direct-visit@example.com");
    const viaOffer = await publicSeat(edited.id, "run-next@example.com");
    const viaDirect = await publicSeat(direct.id, "direct-visit@example.com");

    expect(viaOffer).toMatchObject({
      ok: false,
      reason: "trip_prerequisite",
      refusal: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
    });
    expect(viaOffer).toEqual(viaDirect);

    // The run's other dates, still at their usual site, sell to the same diver.
    expect(await publicSeat(sibling.id, "run-next@example.com")).toMatchObject({ ok: true });
  });
});
