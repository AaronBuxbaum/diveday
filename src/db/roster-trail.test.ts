import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import type { RosterChangeCode } from "@/lib/incident-export";
import { turnAwayReasons } from "@/lib/turn-away";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, restoreBooking } from "./bookings";
import { getIncidentExport } from "./incident-export";
import { type RosterTripActivityEntry, recordTripActivity } from "./operations";
import { getBookingReadiness } from "./readiness";
import { activityEvents, bookings, people } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { turnBookingAway } from "./turn-away";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **Every seat change on a departure's trail names whose seat it was by
 * record, not only by name** (security review 2026-10-16, F1). The departure
 * log prints these lines; erasure reaches a line by its `subject_person_id`,
 * and a line carrying only a name in its params survived a renamed diver's
 * erasure. Each line is written with the seat change, and a held seat is
 * named as it was booked (issue #2128), never as the matched person.
 */
async function seat() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
  if (!trip) throw new Error("expected a booked trip");
  const [first] = await getTripRoster(db, shop.id, trip.id);
  const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"))?.person;
  if (!first || !owner) throw new Error("expected a seat and an owner");
  return { db, shop, trip, owner, bookingId: first.booking.id, person: first.person };
}

async function lines(tripId: string, code: string) {
  return ctx.db
    .select({ subject: activityEvents.subjectPersonId, params: activityEvents.params })
    .from(activityEvents)
    .where(and(eq(activityEvents.tripId, tripId), eq(activityEvents.code, code)));
}

describe("a seat change on the departure's trail", () => {
  it("names a removed seat's diver by record, in the removal itself", async () => {
    const { db, shop, trip, owner, bookingId, person } = await seat();
    await cancelBooking(db, shop.id, bookingId, { trail: { actorPersonId: owner.id } });
    expect(await lines(trip.id, "booking_removed")).toEqual([
      { subject: person.id, params: { actor: owner.fullName, diver: person.fullName } },
    ]);
  });

  it("names a held seat as it was booked, never as the person it was matched to", async () => {
    const { db, shop, trip, owner, bookingId, person } = await seat();
    await db.update(people).set({ fullName: "Joanna Smith" }).where(eq(people.id, person.id));
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2026-10-01T12:00:00Z"),
        identityBookedAs: "Jo Smith",
      })
      .where(eq(bookings.id, bookingId));
    await cancelBooking(db, shop.id, bookingId, { trail: { actorPersonId: owner.id } });
    expect(await lines(trip.id, "booking_removed")).toEqual([
      { subject: person.id, params: { actor: owner.fullName, diver: "Jo Smith" } },
    ]);
  });

  it("names a restored seat's diver by record", async () => {
    const { db, shop, trip, owner, bookingId, person } = await seat();
    await cancelBooking(db, shop.id, bookingId);
    expect(await restoreBooking(db, shop.id, bookingId, { actorPersonId: owner.id })).toBe(
      "restored",
    );
    expect(await lines(trip.id, "booking_restored")).toEqual([
      { subject: person.id, params: { actor: owner.fullName, diver: person.fullName } },
    ]);
  });

  it("names a seat turned away at the desk by record and booking, and the log prints it", async () => {
    // A turn-away after the boat was due out frees a seat like a removal
    // does, so the departure log lists it, with the category and nothing more.
    const { db, shop, trip, owner, bookingId, person } = await seat();
    const readiness = await getBookingReadiness(db, shop.id, bookingId);
    const [reason] = readiness ? turnAwayReasons(readiness) : [];
    if (!reason) throw new Error("expected a blocked seat");
    const late = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason,
        recordedByPersonId: owner.id,
        now: late,
      }),
    ).toMatchObject({ ok: true });
    const [line] = await db
      .select({ subject: activityEvents.subjectPersonId, booking: activityEvents.bookingId })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.tripId, trip.id), eq(activityEvents.code, "booking_turned_away")),
      );
    expect(line).toEqual({ subject: person.id, booking: bookingId });
    const doc = await getIncidentExport(db, shop.id, trip.id, owner.id, late);
    expect(doc?.timeline.filter((entry) => entry.kind === "roster_change")).toEqual([
      expect.objectContaining({ action: "turned_away", subjectName: person.fullName, reason }),
    ]);
  });

  it("writes nothing for a removal that removed nothing", async () => {
    const { db, shop, trip, owner } = await seat();
    expect(
      await cancelBooking(db, shop.id, "99999999-8888-4777-8666-555555555555", {
        trail: { actorPersonId: owner.id },
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await lines(trip.id, "booking_removed")).toEqual([]);
  });

  it("cannot be written without whose seat it was", () => {
    // The compiler holds the rule for every caller: a roster code takes a subject.
    expectTypeOf<RosterTripActivityEntry["code"]>().toEqualTypeOf<RosterChangeCode>();
    const write = () =>
      // @ts-expect-error a seat change names its subject
      recordTripActivity(ctx.db, {
        shopId: ctx.shop.id,
        tripId: "trip",
        actorPersonId: "actor",
        entry: { code: "booking_removed", diver: "Jo Smith" },
      });
    expect(typeof write).toBe("function");
  });
});

describe("the backfill of roster lines written before they named their subject", () => {
  /** Migration 20261016180823_roster-change-subjects, statement by statement. */
  async function backfill() {
    const text = readFileSync(
      join(process.cwd(), "drizzle/20261016180823_roster-change-subjects/migration.sql"),
      "utf8",
    );
    for (const statement of text.split("--> statement-breakpoint")) {
      await ctx.db.execute(sql.raw(statement));
    }
  }

  it("names a removed seat by the one person on the departure with that name", async () => {
    const { db, shop, trip, owner, person } = await seat();
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: owner.id,
      code: "booking_removed",
      params: { actor: owner.fullName, diver: person.fullName },
    });
    await backfill();
    expect(await lines(trip.id, "booking_removed")).toContainEqual({
      subject: person.id,
      params: { actor: owner.fullName, diver: person.fullName },
    });
  });

  it("leaves a moved-away line unnamed: the person by that name still aboard is not whose seat moved", async () => {
    // Security re-review 2026-10-16, item 3: a moved seat no longer sits on
    // its old departure, so the one same-named person still on it is
    // somebody else, and the line would print against them.
    const { db, shop, trip, owner, person } = await seat();
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: owner.id,
      code: "seat_moved_away",
      params: { actor: owner.fullName, diver: person.fullName },
    });
    await backfill();
    expect(await lines(trip.id, "seat_moved_away")).toEqual([
      { subject: null, params: { actor: owner.fullName, diver: person.fullName } },
    ]);
  });
});
