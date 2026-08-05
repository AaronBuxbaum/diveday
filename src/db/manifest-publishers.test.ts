import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, people, personRoles } from "./schema";

/**
 * Which writes announce a manifest change.
 *
 * The seam (`publishManifestEvent`) drives all three refresh triggers — the SSE
 * stream, the offline snapshot save it provokes, and Web Push. Before this,
 * only writes made *on the manifest page itself* published, so push told a
 * captain about their own edits and nothing else. These four are the writes
 * that change the roster from somewhere else while a captain is walking to the
 * boat (ADR 20260804-manifest-web-push, decision 1).
 *
 * Mocked at the seam rather than below it: what matters is that each writer
 * announces, not how the announcement travels.
 */
vi.mock("./manifest-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manifest-events")>();
  return { ...actual, publishManifestEvent: vi.fn() };
});

const { publishManifestEvent } = await import("./manifest-events");
const { seatDiver } = await import("./seat-diver");
const { cancelBooking } = await import("./bookings");
const { setTripCrew } = await import("./trips-crew");
const { callTripBlowout } = await import("./blowouts");
const { upcomingTripsWithCounts } = await import("./trips");

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((candidate) => candidate.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!staff) throw new Error("expected a seeded staff person");
  return { db, shop, trip, staffId: staff.id };
}

beforeEach(() => {
  vi.mocked(publishManifestEvent).mockReset();
});

describe("writes that announce a manifest change", () => {
  it("announces when a diver is seated", async () => {
    // The archetypal case: a walk-in seated at the counter while the captain
    // is already on the dock.
    const { db, shop, trip, staffId } = await context();

    const outcome = await seatDiver(db, {
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: staffId,
      diver: { fullName: "Walk-In Wanda", email: "wanda@example.com" },
      entry: "walk_in",
      refusals: "coarse",
    });
    expect(outcome.ok).toBe(true);

    expect(publishManifestEvent).toHaveBeenCalledWith(db, shop.id, trip.id);
  });

  it("announces when a booking is cancelled", async () => {
    const { db, shop, trip } = await context();
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.tripId, trip.id))
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking");

    await cancelBooking(db, shop.id, booking.id);

    expect(publishManifestEvent).toHaveBeenCalledWith(db, shop.id, trip.id);
  });

  it("does not announce when the cancel matched nothing", async () => {
    // A miss changed no roster, so it must not spend the coalescing budget or
    // wake a phone.
    const { db, shop } = await context();
    await cancelBooking(db, shop.id, "11111111-1111-1111-1111-111111111111");
    expect(publishManifestEvent).not.toHaveBeenCalled();
  });

  it("announces when the crew changes", async () => {
    const { db, shop, trip, staffId } = await context();
    await setTripCrew(db, shop.id, trip.id, [staffId]);
    expect(publishManifestEvent).toHaveBeenCalledWith(db, shop.id, trip.id);
  });

  it("does not announce when a crew change was refused", async () => {
    // A tripId that isn't this shop's changes nothing — `setTripCrew` returns
    // false, and a refusal must stay silent.
    const { db, shop, staffId } = await context();
    const refused = await setTripCrew(db, shop.id, "11111111-1111-1111-1111-111111111111", [
      staffId,
    ]);
    expect(refused).toBe(false);
    expect(publishManifestEvent).not.toHaveBeenCalled();
  });

  it("announces when the departure is blown out", async () => {
    const { db, shop, trip, staffId } = await context();
    const outcome = await callTripBlowout(db, {
      shopId: shop.id,
      tripId: trip.id,
      calledByPersonId: staffId,
    });
    expect(outcome.ok).toBe(true);
    expect(publishManifestEvent).toHaveBeenCalledWith(db, shop.id, trip.id);
  });
});
