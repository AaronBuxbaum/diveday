// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBooking } from "./bookings";
import { type AppDb, createTestDb } from "./client";
import { getShopBySlug, getTripRoster, upcomingTripsWithCounts } from "./queries";
import { people, personRoles } from "./schema";
import { seedDemo } from "./seed";

async function seededContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((t) => t.title === "Wreck Trip — Spiegel Grove");
  if (!open || !fullTrip) throw new Error("expected seeded trips missing");
  return { db, shop, open, fullTrip };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

async function bookVisitor(db: AppDb, shopId: string, tripId: string) {
  return createBooking(db, { shopId, tripId, ...visitor });
}

describe("createBooking (in-memory PGlite)", () => {
  it("books a new visitor, creating a person with the customer role", async () => {
    const { db, shop, open } = await seededContext();
    const outcome = await bookVisitor(db, shop.id, open.id);
    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });

    const roster = await getTripRoster(db, open.id);
    expect(roster.map((r) => r.person.fullName)).toContain("Nora Quinn");

    const [person] = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, visitor.email)));
    if (!person) throw new Error("person not created");
    const roles = await db.select().from(personRoles).where(eq(personRoles.personId, person.id));
    expect(roles.map((r) => r.role)).toContain("customer");
  });

  it("dedupes the person by email across trips", async () => {
    const { db, shop, open } = await seededContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const night = trips.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("night trip missing");

    await bookVisitor(db, shop.id, open.id);
    const second = await createBooking(db, {
      shopId: shop.id,
      tripId: night.id,
      fullName: "NORA QUINN",
      email: "Nora@Example.com", // different case, same human
    });
    expect(second.ok).toBe(true);

    const matches = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, visitor.email)));
    expect(matches).toHaveLength(1);
  });

  it("rejects a full trip", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await bookVisitor(db, shop.id, fullTrip.id);
    expect(outcome).toEqual({ ok: false, reason: "trip_full" });
  });

  it("rejects booking the same trip twice", async () => {
    const { db, shop, open } = await seededContext();
    await bookVisitor(db, shop.id, open.id);
    const again = await bookVisitor(db, shop.id, open.id);
    expect(again).toEqual({ ok: false, reason: "already_booked" });
  });

  it("re-activates a cancelled booking instead of failing", async () => {
    const { db, shop, open } = await seededContext();
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");

    const { bookings } = await import("./schema");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.bookingId));

    const rebook = await bookVisitor(db, shop.id, open.id);
    expect(rebook).toMatchObject({ ok: true, bookingId: first.bookingId });
  });

  it("rejects unknown and cancelled trips", async () => {
    const { db, shop, open } = await seededContext();
    const unknown = await bookVisitor(db, shop.id, "00000000-0000-4000-8000-000000000000");
    expect(unknown).toEqual({ ok: false, reason: "trip_unavailable" });

    const { setTripStatus } = await import("./queries");
    await setTripStatus(db, shop.id, open.id, "cancelled");
    const onCancelled = await bookVisitor(db, shop.id, open.id);
    expect(onCancelled).toEqual({ ok: false, reason: "trip_unavailable" });
  });
});
