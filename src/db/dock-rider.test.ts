// @vitest-environment node
import { and, eq, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { addDockRider, type DockRiderInput } from "./dock-rider";
import { getTripManifests } from "./manifests";
import { activityEvents, boats, bookings, courses, people, personRoles, shops } from "./schema";
import { recordTripStage } from "./trip-stages";
import { createTrip, heldSeatCounts, setTripStatus } from "./trips";

/**
 * **A rider added at the boat goes through the one seating path** (batch 4,
 * D6). Safety-critical: every limit a seat sold anywhere else meets must refuse
 * this one too, and a refused add must leave nothing behind.
 */
const ctx = fileScopedShopContext();

const HOUR = 3_600_000;

async function staffActor(db: AppDb, shopId: string) {
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!staff) throw new Error("seed has no staff actor");
  return staff.id;
}

async function boat(db: AppDb, shopId: string, certifiedPassengers: number | null) {
  const [row] = await db
    .insert(boats)
    .values({
      shopId,
      name: `Hull ${certifiedPassengers ?? "none"}`,
      capacity: 10,
      certifiedPassengers,
    })
    .returning();
  if (!row) throw new Error("boat not inserted");
  return row;
}

async function departure(
  db: AppDb,
  shopId: string,
  input: { capacity: number; boatId?: string; startsAt?: Date } = { capacity: 6 },
) {
  const startsAt = input.startsAt ?? new Date(nowDate().getTime() + 2 * HOUR);
  const trip = await createTrip(db, {
    shopId,
    title: "Dock rider test",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    capacity: input.capacity,
    boatId: input.boatId,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

let seq = 0;
async function sell(db: AppDb, shopId: string, tripId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    seq += 1;
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId,
      tripId,
      fullName: `Passenger ${seq}`,
      email: `dock-passenger-${seq}@example.com`,
    });
    if (!outcome.ok) throw new Error(`seat refused: ${outcome.reason}`);
  }
}

function rider(shopId: string, tripId: string, actorPersonId: string): DockRiderInput {
  return {
    shopId,
    tripId,
    actorPersonId,
    fullName: "Sam Rider",
    phone: "+1 305 555 0100",
    emergencyContactName: "Jo Rider",
    emergencyContactPhone: "+1 305 555 0199",
  };
}

async function liveSeats(db: AppDb, tripId: string) {
  return db
    .select({ id: bookings.id, type: bookings.participantType, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
}

describe("addDockRider", () => {
  it("seats a rider who counts on the manifest at once, with their emergency contact", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id, { capacity: 6 });

    const result = await addDockRider(db, rider(shop.id, trip.id, actor));
    if (!result.ok) throw new Error(`refused: ${result.reason}`);

    const seats = await liveSeats(db, trip.id);
    expect(seats).toEqual([{ id: result.bookingId, type: "rider", personId: result.personId }]);
    expect((await heldSeatCounts(db, shop.id, trip.id)).aboard).toBe(1);

    const [person] = await db.select().from(people).where(eq(people.id, result.personId));
    expect(person).toMatchObject({
      fullName: "Sam Rider",
      email: null,
      emergencyContactName: "Jo Rider",
      emergencyContactPhone: "+1 305 555 0199",
    });

    const [manifest] = (await getTripManifests(db, shop.id, trip.id)) ?? [];
    expect(manifest?.divers.map((diver) => diver.bookingId)).toContain(result.bookingId);
  });

  it("writes the dock's own line on the activity trail", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id);
    const result = await addDockRider(db, rider(shop.id, trip.id, actor));
    expect(result.ok).toBe(true);

    const lines = await db
      .select({ code: activityEvents.code, params: activityEvents.params })
      .from(activityEvents)
      .where(eq(activityEvents.tripId, trip.id));
    expect(lines).toEqual([
      { code: "rider_added_at_dock", params: expect.objectContaining({ diver: "Sam Rider" }) },
    ]);
  });

  it("is refused at the certificate's passenger limit even when the departure states more", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const hull = await boat(db, shop.id, 2);
    const trip = await departure(db, shop.id, { capacity: 4, boatId: hull.id });
    await sell(db, shop.id, trip.id, 2);

    expect(await addDockRider(db, rider(shop.id, trip.id, actor))).toEqual({
      ok: false,
      reason: "trip_full",
    });
    expect(await liveSeats(db, trip.id)).toHaveLength(2);
  });

  it("is refused when the boat is full", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id, { capacity: 2 });
    await sell(db, shop.id, trip.id, 2);

    expect(await addDockRider(db, rider(shop.id, trip.id, actor))).toEqual({
      ok: false,
      reason: "trip_full",
    });
  });

  it("leaves no person row behind when refused", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id, { capacity: 1 });
    await sell(db, shop.id, trip.id, 1);

    await addDockRider(db, rider(shop.id, trip.id, actor));
    const named = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Sam Rider")));
    expect(named).toEqual([]);
  });

  it("is refused on a cancelled departure", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id);
    await setTripStatus(db, shop.id, trip.id, "cancelled");

    expect(await addDockRider(db, rider(shop.id, trip.id, actor))).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });
  });

  it("is refused once the crew has said the boat left the dock", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id);
    const recorded = await recordTripStage(db, {
      shopId: shop.id,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: actor,
    });
    expect(recorded.ok).toBe(true);

    expect(await addDockRider(db, rider(shop.id, trip.id, actor))).toEqual({
      ok: false,
      reason: "departed",
    });
    expect(await liveSeats(db, trip.id)).toEqual([]);
  });

  it("is still allowed while the crew says boarding", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id);
    await recordTripStage(db, {
      shopId: shop.id,
      tripId: trip.id,
      stage: "boarding",
      recordedByPersonId: actor,
    });
    expect((await addDockRider(db, rider(shop.id, trip.id, actor))).ok).toBe(true);
  });

  it("is refused on a departure that has sailed by the clock", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id, {
      capacity: 6,
      startsAt: new Date(nowDate().getTime() - 2 * HOUR),
    });
    expect(await addDockRider(db, rider(shop.id, trip.id, actor))).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });
  });

  it("cannot reach a departure of another shop", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    const [otherShop] = await db
      .insert(shops)
      .values({
        name: "Coral Ledge Divers",
        slug: "coral-ledge-dock-rider",
        timezone: "America/New_York",
      })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("second shop not inserted");
    const [stranger] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Stranger" })
      .returning({ id: people.id });
    if (!stranger) throw new Error("second shop's staffer not inserted");

    expect(await addDockRider(db, rider(otherShop.id, trip.id, stranger.id))).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });
    expect(await liveSeats(db, trip.id)).toEqual([]);
  });

  it("refuses the same name twice on one departure", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id);
    expect((await addDockRider(db, rider(shop.id, trip.id, actor))).ok).toBe(true);

    const again = await addDockRider(db, {
      ...rider(shop.id, trip.id, actor),
      fullName: "  sam RIDER ",
    });
    expect(again).toEqual({ ok: false, reason: "already_aboard" });
    expect(await liveSeats(db, trip.id)).toHaveLength(1);
  });

  it("refuses a name already seated by the desk", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const trip = await departure(db, shop.id);
    await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Sam Rider",
      email: "sam-rider@example.com",
    });
    expect(await addDockRider(db, rider(shop.id, trip.id, actor))).toEqual({
      ok: false,
      reason: "already_aboard",
    });
  });

  it("is refused on a course session, which carries no riders", async () => {
    const { db, shop } = ctx;
    const actor = await staffActor(db, shop.id);
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    if (!course) throw new Error("seed has no course");
    const startsAt = new Date(nowDate().getTime() + 2 * HOUR);
    const session = await createTrip(db, {
      shopId: shop.id,
      title: "Course session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR),
      capacity: 6,
      courseId: course.id,
    });
    if (!session) throw new Error("session not created");

    const result = await addDockRider(db, rider(shop.id, session.id, actor));
    expect(result.ok).toBe(false);
    expect(await liveSeats(db, session.id)).toEqual([]);
  });
});
