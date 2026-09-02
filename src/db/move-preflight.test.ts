import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { recordRollCall } from "./manifests";
import { DELIVERY_KIND_CLASSIFICATION, getMovePreflight } from "./move-preflight";
import { countTripOrders } from "./orders";
import {
  bookings,
  gearReservations,
  notificationDeliveries,
  notificationKind,
  rollCallEvents,
  shops,
  trips,
} from "./schema";
import { getTripRoster, listStaff, moveTrip, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/** The seeded departure with the most seats on it — the one with consequences. */
async function busiestTrip() {
  const upcoming = await upcomingTripsWithCounts(ctx.db, ctx.shop.id, new Date(0));
  const busiest = [...upcoming].sort((a, b) => b.booked - a.booked)[0];
  if (!busiest) throw new Error("seed has no upcoming departures");
  return busiest;
}

/**
 * Everything the preview reads, as it stands right now. Compared before and
 * after a call to prove the preflight path writes nothing — the boundary this
 * feature's ticket is actually about (#1203: "no writes at all in the
 * preflight path"), and the one a comment saying "read-only" cannot establish.
 */
async function writableState(shopId: string, tripId: string) {
  const [trip] = await ctx.db.select().from(trips).where(eq(trips.id, tripId));
  const [seats, reservations, deliveries, rollCall] = await Promise.all([
    ctx.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, tripId)))
      .orderBy(asc(bookings.id)),
    ctx.db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.shopId, shopId))
      .orderBy(asc(gearReservations.id)),
    ctx.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.shopId, shopId))
      .orderBy(asc(notificationDeliveries.id)),
    ctx.db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId)))
      .orderBy(asc(rollCallEvents.id)),
  ]);
  return { trip, seats, reservations, deliveries, rollCall };
}

/** Mark one seat as having been sent a message naming the date it now holds. */
async function markTold(
  shopId: string,
  bookingId: string,
  kind: "booking_confirmation" | "trip_reminder_7d" | "trip_reminder_24h",
) {
  await ctx.db.insert(notificationDeliveries).values({
    shopId,
    bookingId,
    kind,
    status: "sent",
    attemptedAt: new Date("2026-09-01T12:00:00.000Z"),
  });
}

describe("getMovePreflight", () => {
  it("has no preview for a departure that is not this shop's", async () => {
    const trip = await busiestTrip();
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Another Shop", slug: "another-shop-preflight", timezone: "UTC" })
      .returning();
    expect(await getMovePreflight(ctx.db, other.id, trip.id)).toBeNull();
  });

  /**
   * The design constraint from the ticket's triage, made a test: the preview
   * must not become a second source of truth. Each number is asserted against
   * the reader the real path uses, so a preview that quietly grew its own
   * definition of "on this trip" fails here rather than in a shop's hands.
   */
  it("counts exactly what the readers the move itself uses count", async () => {
    const trip = await busiestTrip();
    const [roster, paid] = await Promise.all([
      getTripRoster(ctx.db, ctx.shop.id, trip.id),
      countTripOrders(ctx.db, ctx.shop.id, trip.id, "paid"),
    ]);
    // Every seat told, so the `told` section reports the roster's own count.
    for (const row of roster) await markTold(ctx.shop.id, row.booking.id, "trip_reminder_7d");

    const preflight = await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    const told = preflight?.sections.find((section) => section.kind === "told");
    expect(told).toEqual({ kind: "told", reminded: roster.length });

    // Crew is deliberately not a section — see `src/lib/move-preflight.ts`.
    expect(preflight?.sections.map((section) => section.kind)).not.toContain("crew");

    const money = preflight?.sections.find((section) => section.kind === "money");
    expect(money?.paid ?? 0).toBe(paid);
  });

  /**
   * `notification_deliveries` holds one row per (booking, kind), so a diver who
   * has had a confirmation *and* a reminder is still one person to write to.
   * Counting rows here would overstate the work by a factor of three on the
   * night before a trip, which is exactly when a shop reads this.
   */
  it("counts a diver who has had several messages once", async () => {
    const trip = await busiestTrip();
    const roster = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    const [first] = roster;
    expect(first).toBeDefined();
    await markTold(ctx.shop.id, first.booking.id, "booking_confirmation");
    await markTold(ctx.shop.id, first.booking.id, "trip_reminder_24h");

    const preflight = await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    const told = preflight?.sections.find((section) => section.kind === "told");
    expect(told).toEqual({ kind: "told", reminded: 1 });
    expect(roster.length).toBeGreaterThan(1);
  });

  /**
   * The correction that made this feature honest, pinned. `booking_confirmation`
   * prints the departure's date and time as their own paragraph, so a diver
   * holding one has been told the date as squarely as one holding a reminder —
   * and it is the message a departure actually accumulates, since the reminder
   * cadences only fire inside the last week.
   */
  it("counts a booking confirmation as having been told the date", async () => {
    const trip = await busiestTrip();
    const roster = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    await markTold(ctx.shop.id, roster[0].booking.id, "booking_confirmation");

    const preflight = await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    expect(preflight?.sections).toContainEqual({ kind: "told", reminded: 1 });
  });

  /**
   * The other half of the same judgement. A recap speaks about a day that is
   * already over, so nothing it said is invalidated by moving the departure —
   * counting it would send a shop chasing divers who need no telling.
   */
  it("does not count a message that named no future date", async () => {
    const trip = await busiestTrip();
    const roster = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    await ctx.db.insert(notificationDeliveries).values({
      shopId: ctx.shop.id,
      bookingId: roster[0].booking.id,
      kind: "trip_recap",
      status: "sent",
      attemptedAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    const preflight = await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    expect(preflight?.sections.some((section) => section.kind === "told")).toBe(false);
  });

  /**
   * The classification has to be **total**. A kind added to the enum and left
   * out of both lists would silently read as "nobody was told", which is the
   * one way this number can be wrong without anything looking broken.
   */
  it("classifies every delivery kind the schema allows", () => {
    const { toldTheDate, notAFutureDate } = DELIVERY_KIND_CLASSIFICATION;
    expect([...toldTheDate, ...notAFutureDate].sort()).toEqual(
      [...notificationKind.enumValues].sort(),
    );
    // Disjoint, so a kind cannot be counted and excused at once.
    expect(toldTheDate.filter((kind) => notAFutureDate.some((other) => other === kind))).toEqual(
      [],
    );
  });

  it("says nothing about a departure nobody has been told about", async () => {
    const trip = await busiestTrip();
    const preflight = await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    expect(preflight?.sections.some((section) => section.kind === "told")).toBe(false);
  });

  /**
   * The claim that makes the preview trustworthy: its refusal and `moveTrip`'s
   * are the same answer, because they ask the same function. Asserted by
   * running both against one departure rather than by reading the code.
   */
  it("refuses in step with the mutation once a roll call exists", async () => {
    const trip = await busiestTrip();
    expect((await getMovePreflight(ctx.db, ctx.shop.id, trip.id))?.blocked).toBeNull();

    // Written through the real recorder, not an insert of my own: the guard is
    // about evidence the crew actually left, and a hand-built row could satisfy
    // a count while being a shape `recordRollCall` never produces.
    const roster = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    const [recorder] = await listStaff(ctx.db, ctx.shop.id);
    expect(
      await recordRollCall(ctx.db, {
        shopId: ctx.shop.id,
        tripId: trip.id,
        bookingId: roster[0].booking.id,
        recordedByPersonId: recorder.person.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });

    expect((await getMovePreflight(ctx.db, ctx.shop.id, trip.id))?.blocked).toBe("already_sailed");
    expect(
      await moveTrip(ctx.db, ctx.shop.id, trip.id, new Date("2099-07-04T13:00:00.000Z")),
    ).toEqual({ ok: false, reason: "already_sailed" });
  });

  it("says a cancelled departure cannot move, as the mutation does", async () => {
    const trip = await busiestTrip();
    await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));

    expect((await getMovePreflight(ctx.db, ctx.shop.id, trip.id))?.blocked).toBe("not_scheduled");
    expect(
      await moveTrip(ctx.db, ctx.shop.id, trip.id, new Date("2099-07-04T13:00:00.000Z")),
    ).toEqual({ ok: false, reason: "not_scheduled" });
  });

  /**
   * The boundary, stated as state rather than as intent: nothing about the
   * departure, its seats, its reservations or its delivery log differs by one
   * byte across a preflight. In particular no gear reservation has been
   * re-windowed and no notification row invented — the two writes the real move
   * and the real reminder pass make.
   */
  it("writes nothing", async () => {
    const trip = await busiestTrip();
    const roster = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    await markTold(ctx.shop.id, roster[0].booking.id, "trip_reminder_7d");

    const before = await writableState(ctx.shop.id, trip.id);
    await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    await getMovePreflight(ctx.db, ctx.shop.id, trip.id);
    const after = await writableState(ctx.shop.id, trip.id);

    expect(after).toEqual(before);
  });
});
