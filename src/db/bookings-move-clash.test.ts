import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, moveBooking, moveParty } from "./bookings";
import { bookings } from "./schema";
import { createTrip, setTripStatus } from "./trips";

const ctx = fileScopedShopContext();
async function setup(otherStart: string, otherEnd: string) {
  const { db, shop } = ctx;
  const make = (title: string, startsAt: string, endsAt: string) =>
    createTrip(db, {
      shopId: shop.id,
      title,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      capacity: 8,
    });
  const source = await make("Source", "2035-08-04T05:00:00Z", "2035-08-04T07:00:00Z");
  const target = await make("Target", "2035-08-04T08:00:00Z", "2035-08-04T12:00:00Z");
  const other = await make("Other", otherStart, otherEnd);
  if (!source || !target || !other) throw new Error("expected trips");
  const seat = await createBooking(db, {
    shopId: shop.id,
    tripId: source.id,
    actor: "staff",
    fullName: "Collision Test",
    email: "collision@example.test",
  });
  if (!seat.ok) throw new Error(seat.reason);
  const second = await createBooking(db, {
    shopId: shop.id,
    tripId: other.id,
    actor: "staff",
    personId: seat.personId,
  });
  if (!second.ok) throw new Error(second.reason);
  const move = () =>
    moveBooking(db, {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      bookingId: seat.bookingId,
      rejectScheduleClashes: true,
    });
  return { db, shop, source, target, other, seat, move };
}

describe("schedule day diver moves", () => {
  it("rolls the whole party back when one member has another overlapping booking", async () => {
    const { db, shop, source, target, seat } = await setup(
      "2035-08-04T11:00:00Z",
      "2035-08-04T14:00:00Z",
    );
    const guest = await createBooking(db, {
      shopId: shop.id,
      tripId: source.id,
      actor: "staff",
      fullName: "Party Guest",
      email: "party-guest@example.test",
    });
    if (!guest.ok) throw new Error(guest.reason);
    await db
      .update(bookings)
      .set({ partyLeadBookingId: seat.bookingId })
      .where(eq(bookings.id, guest.bookingId));
    const outcome = await moveParty(db, {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      leadBookingId: seat.bookingId,
      rejectScheduleClashes: true,
    });
    expect(outcome).toMatchObject({ ok: false, outcome: { reason: "schedule_clash" } });
    const [leadRow] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, seat.bookingId));
    const [guestRow] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, guest.bookingId));
    expect([leadRow?.tripId, guestRow?.tripId]).toEqual([source.id, source.id]);
  });
  it("refuses an overlapping other seat without moving the source", async () => {
    const { db, source, seat, move } = await setup("2035-08-04T11:00:00Z", "2035-08-04T14:00:00Z");
    expect(await move()).toEqual({ ok: false, reason: "schedule_clash" });
    const [row] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, seat.bookingId));
    expect(row?.tripId).toBe(source.id);
  });
  it("allows a departure that starts exactly when the target ends", async () => {
    const { move } = await setup("2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
    expect((await move()).ok).toBe(true);
  });
  it("ignores a cancelled other departure", async () => {
    const { db, shop, other, move } = await setup("2035-08-04T11:00:00Z", "2035-08-04T14:00:00Z");
    await setTripStatus(db, shop.id, other.id, "cancelled");
    expect((await move()).ok).toBe(true);
  });
});

it("refuses a move that overlaps the diver's crew assignment", async () => {
  const { db, shop, source, seat, move } = await setup(
    "2035-08-04T12:00:00Z",
    "2035-08-04T14:00:00Z",
  );
  const { personRoles } = await import("./schema");
  const { setTripCrew } = await import("./trips");
  await db.insert(personRoles).values({ personId: seat.personId, role: "divemaster" });
  const other = await createTrip(db, {
    shopId: shop.id,
    title: "Crew work",
    startsAt: new Date("2035-08-04T09:00:00Z"),
    endsAt: new Date("2035-08-04T11:00:00Z"),
    capacity: 8,
  });
  if (!other) throw new Error("expected trip");
  expect(await setTripCrew(db, shop.id, other.id, [seat.personId])).toBe(true);
  expect(await move()).toEqual({ ok: false, reason: "schedule_clash" });
  const [row] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, seat.bookingId));
  expect(row?.tripId).toBe(source.id);
});

it("refuses a diver move that leaves the same person crewing the source at overlapping hours", async () => {
  const { db, shop } = ctx;
  const source = await createTrip(db, {
    shopId: shop.id,
    title: "Dual source",
    startsAt: new Date("2035-08-04T08:00:00Z"),
    endsAt: new Date("2035-08-04T12:00:00Z"),
    capacity: 8,
  });
  const target = await createTrip(db, {
    shopId: shop.id,
    title: "Dual target",
    startsAt: new Date("2035-08-04T09:00:00Z"),
    endsAt: new Date("2035-08-04T13:00:00Z"),
    capacity: 8,
  });
  if (!source || !target) throw new Error("expected trips");
  const seat = await createBooking(db, {
    shopId: shop.id,
    tripId: source.id,
    actor: "staff",
    fullName: "Dual Role",
    email: "dual-role@example.test",
  });
  if (!seat.ok) throw new Error(seat.reason);
  const { personRoles } = await import("./schema");
  const { setTripCrew } = await import("./trips");
  await db.insert(personRoles).values({ personId: seat.personId, role: "divemaster" });
  expect(await setTripCrew(db, shop.id, source.id, [seat.personId])).toBe(true);
  expect(
    await moveBooking(db, {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      bookingId: seat.bookingId,
      rejectScheduleClashes: true,
    }),
  ).toEqual({ ok: false, reason: "schedule_clash" });
});

it("requires an unconfirmed identity to be resolved before a checked move", async () => {
  const { db, source, seat, move } = await setup("2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
  await db
    .update(bookings)
    .set({
      identityUnconfirmedAt: new Date("2035-08-01T00:00:00Z"),
      identityBookedAs: "Different Name",
    })
    .where(eq(bookings.id, seat.bookingId));
  expect(await move()).toEqual({ ok: false, reason: "not_movable" });
  const [row] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, seat.bookingId));
  expect(row?.tripId).toBe(source.id);
});

it("refuses a checked move if the selected target has left the displayed day", async () => {
  const { db, shop, source, target, seat } = await setup(
    "2035-08-04T12:00:00Z",
    "2035-08-04T14:00:00Z",
  );
  const { moveTrip } = await import("./trips");
  expect((await moveTrip(db, shop.id, target.id, new Date("2035-08-05T08:00:00Z"))).ok).toBe(true);
  const result = await moveBooking(db, {
    shopId: shop.id,
    fromTripId: source.id,
    toTripId: target.id,
    bookingId: seat.bookingId,
    rejectScheduleClashes: true,
    expectedDay: { day: "2035-08-04", timeZone: "UTC" },
  });
  expect(result).toEqual({ ok: false, reason: "target_unavailable" });
});

it("rolls back the whole party when a follower's identity is unconfirmed", async () => {
  const { db, shop, source, target, seat } = await setup(
    "2035-08-04T12:00:00Z",
    "2035-08-04T14:00:00Z",
  );
  const first = await createBooking(db, {
    shopId: shop.id,
    tripId: source.id,
    actor: "staff",
    fullName: "Confirmed Follower",
    email: "confirmed-follower@example.test",
  });
  if (!first.ok) throw new Error(first.reason);
  await db
    .update(bookings)
    .set({ partyLeadBookingId: seat.bookingId, createdAt: new Date("2035-07-01T00:00:00Z") })
    .where(eq(bookings.id, first.bookingId));
  const guest = await createBooking(db, {
    shopId: shop.id,
    tripId: source.id,
    actor: "staff",
    fullName: "Held Follower",
    email: "held-follower@example.test",
  });
  if (!guest.ok) throw new Error(guest.reason);
  await db
    .update(bookings)
    .set({
      partyLeadBookingId: seat.bookingId,
      identityUnconfirmedAt: new Date("2035-08-01T00:00:00Z"),
      identityBookedAs: "Different Follower",
      createdAt: new Date("2035-07-02T00:00:00Z"),
    })
    .where(eq(bookings.id, guest.bookingId));
  const result = await moveParty(db, {
    shopId: shop.id,
    fromTripId: source.id,
    toTripId: target.id,
    leadBookingId: seat.bookingId,
    rejectScheduleClashes: true,
  });
  expect(result).toMatchObject({
    ok: false,
    bookingId: guest.bookingId,
    outcome: { reason: "not_movable" },
  });
  const [lead] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, seat.bookingId));
  expect(lead?.tripId).toBe(source.id);
  const [firstRow] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, first.bookingId));
  expect(firstRow?.tripId).toBe(source.id);
});
