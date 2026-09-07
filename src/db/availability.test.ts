// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { availabilityDocument } from "@/lib/availability";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { publicAvailabilityTrips } from "./availability";
import { createBooking } from "./bookings";
import { upsertTripRequirements } from "./readiness";
import { trips } from "./schema";
import { createTrip } from "./trips";

const ctx = fileScopedShopContext();
const DAY_MS = 24 * 60 * 60 * 1000;

async function departure(
  daysOut: number,
  overrides: Partial<Parameters<typeof createTrip>[1]> = {},
): Promise<string> {
  const startsAt = new Date(nowDate().getTime() + daysOut * DAY_MS);
  const trip = await createTrip(ctx.db, {
    shopId: ctx.shop.id,
    title: `Probe ${daysOut}d`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 2,
    priceCents: 12_000,
    ...overrides,
  });
  if (!trip) throw new Error("createTrip refused the probe departure");
  return trip.id;
}

describe("publicAvailabilityTrips (in-memory PGlite)", () => {
  it("lists a public, scheduled departure with a seat open, inside two weeks", async () => {
    const id = await departure(3);
    const rows = await publicAvailabilityTrips(ctx.db, ctx.shop);
    const row = rows.find((trip) => trip.id === id);
    expect(row).toMatchObject({ title: "Probe 3d", capacity: 2, booked: 0, priceCents: 12_000 });
    // A fun dive starts life asking for an Open Water card (`createTrip`'s
    // default requirement row), and the document says so as a code.
    expect(row?.requirement).toEqual({
      minimumCertificationLevel: "open_water",
      requiredSpecialties: [],
      requiresNitrox: false,
    });
  });

  it("leaves out a private charter, a full boat, a held departure, and one past the window", async () => {
    const privateId = await departure(2, { isPrivate: true });
    const farId = await departure(15);
    const fullId = await departure(4, { capacity: 1 });
    const heldId = await departure(5);
    const cancelledId = await departure(6);
    await createBooking(ctx.db, {
      actor: "staff",
      shopId: ctx.shop.id,
      tripId: fullId,
      fullName: "Probe Diver",
      email: "probe-diver@example.com",
    });
    await ctx.db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, heldId));
    await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, cancelledId));

    const ids = (await publicAvailabilityTrips(ctx.db, ctx.shop)).map((trip) => trip.id);
    expect(ids).not.toContain(privateId);
    expect(ids).not.toContain(farId);
    expect(ids).not.toContain(fullId);
    expect(ids).not.toContain(cancelledId);
    // The reader hands the held departure through with its flag set; the
    // document builder is what drops it, and the test below proves the pair.
    const held = (await publicAvailabilityTrips(ctx.db, ctx.shop)).find((t) => t.id === heldId);
    expect(held?.conditionsHold).toBe(true);
    const doc = availabilityDocument(
      ctx.shop,
      await publicAvailabilityTrips(ctx.db, ctx.shop),
      "https://dive.day",
    );
    expect(doc.departures.map((d) => d.id)).not.toContain(heldId);
  });

  it("carries the gate the departure and its sites impose, as codes", async () => {
    const id = await departure(7);
    await upsertTripRequirements(ctx.db, {
      shopId: ctx.shop.id,
      tripId: id,
      requiresWaiver: true,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
      requiresPayment: false,
    });
    const row = (await publicAvailabilityTrips(ctx.db, ctx.shop)).find((trip) => trip.id === id);
    expect(row?.requirement).toEqual({
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
    });
  });

  it("names the sites the boat visits and never a person", async () => {
    const rows = await publicAvailabilityTrips(ctx.db, ctx.shop);
    expect(rows.length).toBeGreaterThan(0);
    const withSites = rows.find((trip) => trip.sites.length > 0);
    expect(withSites, "the seeded schedule names at least one site").toBeDefined();
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "booked",
          "capacity",
          "conditionsHold",
          "endsAt",
          "id",
          "priceCents",
          "requirement",
          "sites",
          "startsAt",
          "title",
        ].sort(),
      );
    }
  });
});
