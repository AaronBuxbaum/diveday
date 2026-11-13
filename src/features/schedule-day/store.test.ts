import { describe, expect, it } from "vitest";
import { createTrip, listStaff, moveTrip, setTripCrew, setTripStatus } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { readScheduleDay } from "./store";

const ctx = fileScopedShopContext();

describe("readScheduleDay", () => {
  it("shows cross-role overlaps but not adjacent legs or unconfirmed identities", async () => {
    const { db, shop } = ctx;
    const { createBooking } = await import("@/db/bookings");
    const { bookings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const person = (await listStaff(db, shop.id))[0]?.person;
    if (!person) throw new Error("expected staff");
    const make = (title: string, start: string, end: string) =>
      createTrip(db, {
        shopId: shop.id,
        title,
        startsAt: new Date(`2035-08-04T${start}:00Z`),
        endsAt: new Date(`2035-08-04T${end}:00Z`),
        capacity: 8,
      });
    const first = await make("Crew boat", "08:00", "12:00");
    const overlap = await make("Diver boat", "10:00", "11:00");
    const adjacent = await make("Later boat", "12:00", "14:00");
    if (!first || !overlap || !adjacent) throw new Error("expected trips");
    expect(await setTripCrew(db, shop.id, first.id, [person.id])).toBe(true);
    const seat = await createBooking(db, {
      shopId: shop.id,
      tripId: overlap.id,
      actor: "staff",
      personId: person.id,
    });
    const later = await createBooking(db, {
      shopId: shop.id,
      tripId: adjacent.id,
      actor: "staff",
      personId: person.id,
    });
    if (!seat.ok || !later.ok) throw new Error("expected bookings");
    let rows = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
    expect(rows.find((row) => row.tripId === first.id)?.collisions).toEqual([
      { personId: person.id, otherTripId: overlap.id, otherTitle: "Diver boat" },
    ]);
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2035-08-01T00:00:00Z"),
        identityBookedAs: "Unconfirmed Diver",
      })
      .where(eq(bookings.id, seat.bookingId));
    rows = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
    expect(rows.find((row) => row.tripId === first.id)?.collisions).toEqual([]);
    expect(rows.find((row) => row.tripId === overlap.id)?.divers[0]).toMatchObject({
      name: "Unconfirmed Diver",
      personId: null,
    });
  });

  it("names the other departure when a later schedule move creates a crew clash", async () => {
    const { db, shop } = ctx;
    const person = (await listStaff(db, shop.id))[0]?.person;
    if (!person) throw new Error("expected staff");
    const input = { shopId: shop.id, capacity: 8 };
    const first = await createTrip(db, {
      ...input,
      title: "First",
      startsAt: new Date("2035-08-04T08:00:00Z"),
      endsAt: new Date("2035-08-04T10:00:00Z"),
    });
    const second = await createTrip(db, {
      ...input,
      title: "Second",
      startsAt: new Date("2035-08-04T12:00:00Z"),
      endsAt: new Date("2035-08-04T14:00:00Z"),
    });
    if (!first || !second) throw new Error("expected trips");
    expect(await setTripCrew(db, shop.id, first.id, [person.id])).toBe(true);
    expect(await setTripCrew(db, shop.id, second.id, [person.id])).toBe(true);
    expect((await moveTrip(db, shop.id, second.id, new Date("2035-08-04T09:00:00Z"))).ok).toBe(
      true,
    );
    const rows = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
    expect(rows.find((row) => row.tripId === first.id)?.collisions).toEqual([
      { personId: person.id, otherTripId: second.id, otherTitle: "Second" },
    ]);
  });

  it("shows live legs in the shop day, including an overnight leg, and excludes cancellations", async () => {
    const { db, shop } = ctx;
    const person = (await listStaff(db, shop.id))[0]?.person;
    if (!person) throw new Error("expected staff");
    const input = { shopId: shop.id, capacity: 8 };
    const overnight = await createTrip(db, {
      ...input,
      title: "Overnight",
      startsAt: new Date("2035-08-03T23:00:00Z"),
      endsAt: new Date("2035-08-04T02:00:00Z"),
    });
    const afternoon = await createTrip(db, {
      ...input,
      title: "Afternoon",
      startsAt: new Date("2035-08-04T14:00:00Z"),
      endsAt: new Date("2035-08-04T18:00:00Z"),
    });
    const cancelled = await createTrip(db, {
      ...input,
      title: "Cancelled",
      startsAt: new Date("2035-08-04T10:00:00Z"),
      endsAt: new Date("2035-08-04T12:00:00Z"),
    });
    if (!overnight || !afternoon || !cancelled) throw new Error("expected trips");
    expect(await setTripCrew(db, shop.id, overnight.id, [person.id])).toBe(true);
    await setTripStatus(db, shop.id, cancelled.id, "cancelled");
    const rows = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
    expect(rows.map((row) => row.tripId)).toEqual([overnight.id, afternoon.id]);
    expect(rows[0]?.crew.map((crew) => crew.id)).toContain(person.id);
    expect(
      await readScheduleDay(db, "00000000-0000-4000-8000-000000000099", "2035-08-04", "UTC"),
    ).toEqual([]);
  });
});

it("keeps an unconfirmed seat's booked name and withholds the matched person", async () => {
  const { db, shop } = ctx;
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Held identity",
    startsAt: new Date("2035-08-04T08:00:00Z"),
    endsAt: new Date("2035-08-04T12:00:00Z"),
    capacity: 8,
  });
  if (!trip) throw new Error("expected trip");
  const { createBooking } = await import("@/db/bookings");
  const { bookings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const seat = await createBooking(db, {
    shopId: shop.id,
    tripId: trip.id,
    actor: "staff",
    fullName: "Anna Smith",
    email: "identity@example.test",
  });
  if (!seat.ok) throw new Error(seat.reason);
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: new Date("2035-08-01T00:00:00Z"), identityBookedAs: "Ana Silva" })
    .where(eq(bookings.id, seat.bookingId));
  const rows = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
  expect(rows[0]?.divers[0]).toMatchObject({
    name: "Ana Silva",
    personId: null,
    identityHeld: true,
  });
});

it("reports an overlapping hull and bookings above the places available with crew", async () => {
  const { db, shop } = ctx;
  const { createBoat } = await import("@/features/boats");
  const { createBooking } = await import("@/db/bookings");
  const boat = await createBoat(db, shop.id, "Review Boat", 4);
  const make = (title: string) =>
    createTrip(db, {
      shopId: shop.id,
      title,
      boatId: boat.id,
      startsAt: new Date("2035-08-04T08:00:00Z"),
      endsAt: new Date("2035-08-04T12:00:00Z"),
      capacity: 4,
    });
  const first = await make("First hull");
  const other = await make("Other hull");
  if (!first || !other) throw new Error("expected trips");
  for (let n = 0; n < 4; n++) {
    const booked = await createBooking(db, {
      shopId: shop.id,
      tripId: first.id,
      actor: "staff",
      fullName: `Capacity Diver ${n}`,
      email: `capacity-${n}@example.test`,
    });
    if (!booked.ok) throw new Error(booked.reason);
  }
  const person = (await listStaff(db, shop.id))[0]?.person;
  if (!person) throw new Error("expected staff");
  expect(await setTripCrew(db, shop.id, first.id, [person.id])).toBe(true);
  const rows = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
  const row = rows.find((entry) => entry.tripId === first.id);
  expect(row?.boatClashes).toContainEqual({
    otherTripId: other.id,
    otherTitle: "Other hull",
    boatName: "Review Boat",
  });
  expect(row?.overSellableCapacity).toBe(true);
});

it("counts a dual-role person once against the certified total, and treats a held identity separately", async () => {
  const { db, shop } = ctx;
  const { createBoat } = await import("@/features/boats");
  const { createBooking } = await import("@/db/bookings");
  const { boats, bookings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const boat = await createBoat(db, shop.id, "Total certificate", 8);
  await db.update(boats).set({ certifiedTotalPersons: 4 }).where(eq(boats.id, boat.id));
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Certified total",
    boatId: boat.id,
    startsAt: new Date("2035-08-04T08:00:00Z"),
    endsAt: new Date("2035-08-04T12:00:00Z"),
    capacity: 8,
  });
  if (!trip) throw new Error("expected trip");
  const person = (await listStaff(db, shop.id))[0]?.person;
  if (!person) throw new Error("expected staff");
  const dual = await createBooking(db, {
    shopId: shop.id,
    tripId: trip.id,
    actor: "staff",
    personId: person.id,
  });
  if (!dual.ok) throw new Error(dual.reason);
  for (let n = 0; n < 3; n++) {
    const result = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      actor: "staff",
      fullName: `Total Diver ${n}`,
      email: `total-${n}@example.test`,
    });
    if (!result.ok) throw new Error(result.reason);
  }
  expect(await setTripCrew(db, shop.id, trip.id, [person.id])).toBe(true);
  let [row] = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
  expect(row?.totalPersonNotice).toBeNull();
  await db
    .update(bookings)
    .set({
      identityUnconfirmedAt: new Date("2035-08-01T00:00:00Z"),
      identityBookedAs: "Another Person",
    })
    .where(eq(bookings.id, dual.bookingId));
  [row] = await readScheduleDay(db, shop.id, "2035-08-04", "UTC");
  expect(row?.totalPersonNotice).toMatchObject({
    code: "over_total_persons",
    persons: 5,
    limit: 4,
    counted: false,
  });
});
