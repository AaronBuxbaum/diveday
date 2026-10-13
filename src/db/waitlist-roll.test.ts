import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { tripWaitlistEntries } from "./schema";
import { createTrip, createTripSeries } from "./trips";
import { carryWaitlist, rollSailedSeriesWaitlists } from "./waitlist-roll";

/**
 * **The wait list rolls forward** (third UX review, item 12). Leads copy, never
 * move; each keeps the time it first asked; a diver already seated on the
 * target is left alone; and a second run adds nobody twice.
 */

const ctx = fileScopedShopContext();
const SAT = 6;

async function lead(db: AppDb, shopId: string, tripId: string, name: string, invitedAt?: Date) {
  const person = await createDiver(db, {
    shopId,
    fullName: name,
    email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!person) throw new Error("diver failed");
  await db.insert(tripWaitlistEntries).values({
    shopId,
    tripId,
    personId: person.id,
    createdAt: new Date("2030-08-01T12:00:00Z"),
    invitedAt: invitedAt ?? null,
  });
  return person;
}

async function waiting(db: AppDb, tripId: string) {
  return db
    .select({
      personId: tripWaitlistEntries.personId,
      createdAt: tripWaitlistEntries.createdAt,
      invitedAt: tripWaitlistEntries.invitedAt,
    })
    .from(tripWaitlistEntries)
    .where(eq(tripWaitlistEntries.tripId, tripId));
}

async function saturdays(capacity = 12) {
  const { db, shop } = ctx;
  const result = await createTripSeries(db, {
    shopId: shop.id,
    title: "Saturday Two-Tank",
    capacity,
    plannedDives: 2,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([SAT]),
    anchorDate: "2030-09-07",
    endsOn: "2030-09-21",
    timeZone: shop.timezone,
    template: {
      startsAt: new Date("2030-09-07T12:00:00.000Z"),
      endsAt: new Date("2030-09-07T16:00:00.000Z"),
    },
  });
  if (!result) throw new Error("series failed");
  const [first, second] = result.trips;
  if (!first || !second) throw new Error("expected two dates");
  // The night after the first Saturday sailed.
  const now = new Date(first.startsAt.getTime() + 12 * 60 * 60 * 1000);
  return { db, shop, first, second, now };
}

describe("rollSailedSeriesWaitlists", () => {
  it("rolls uninvited leads onto the next date and invites them while it has seats", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const ana = await lead(db, shop.id, first.id, "Ana Reyes");
    const worked = await lead(db, shop.id, first.id, "Ben Worked", new Date("2030-09-06T00:00Z"));

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 1 });
    const next = await waiting(db, second.id);
    expect(next).toEqual([
      {
        personId: ana.id,
        createdAt: new Date("2030-08-01T12:00:00Z"),
        invitedAt: now,
      },
    ]);
    expect(next.map((row) => row.personId)).not.toContain(worked.id);
    // The record of what they asked for stays on the date they asked about.
    expect((await waiting(db, first.id)).map((row) => row.personId)).toContain(ana.id);

    // A second night adds nobody twice and invites nobody again.
    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 0, invited: 0 });
  });

  it("rolls a lead onto a full next date without inviting them", async () => {
    const { db, shop, first, second, now } = await saturdays(1);
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      fullName: "Seat Holder",
      email: "seat-holder@example.com",
    });
    if (!booked.ok) throw new Error("booking failed");
    await lead(db, shop.id, first.id, "Cara Full");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 0 });
    expect((await waiting(db, second.id))[0]?.invitedAt).toBeNull();
  });

  it("does not roll a date that has not sailed", async () => {
    const { db, shop, first } = await saturdays();
    await lead(db, shop.id, first.id, "Dan Early");
    expect(await rollSailedSeriesWaitlists(db, new Date(first.startsAt.getTime() - 1))).toEqual({
      rolled: 0,
      invited: 0,
    });
  });
});

describe("carryWaitlist", () => {
  it("copies every lead to the departure staff chose, skipping a diver already seated there", async () => {
    const { db, shop, first, now } = await saturdays();
    const second = await createTrip(db, {
      shopId: shop.id,
      title: "Saturday Two-Tank — second boat",
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      capacity: 8,
      plannedDives: 2,
    });
    if (!second) throw new Error("second departure failed");
    const before = new Date(first.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const eve = await lead(db, shop.id, first.id, "Eve Lead", new Date("2030-09-01T00:00Z"));
    const fay = await lead(db, shop.id, first.id, "Fay Seated");
    const seated = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      personId: fay.id,
    });
    if (!seated.ok) throw new Error("seat failed");

    expect(
      await carryWaitlist(db, {
        shopId: shop.id,
        fromTripId: first.id,
        toTripId: second.id,
        now: before,
      }),
    ).toEqual({ ok: true, carried: 1 });
    expect(await waiting(db, second.id)).toEqual([
      { personId: eve.id, createdAt: new Date("2030-08-01T12:00:00Z"), invitedAt: null },
    ]);
    // A departure that has left takes nobody.
    expect(
      await carryWaitlist(db, { shopId: shop.id, fromTripId: second.id, toTripId: first.id, now }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
  });

  it("refuses this departure itself and another shop's", async () => {
    const { db, shop, first } = await saturdays();
    expect(
      await carryWaitlist(db, { shopId: shop.id, fromTripId: first.id, toTripId: first.id }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
    expect(
      await carryWaitlist(db, {
        shopId: shop.id,
        fromTripId: first.id,
        toTripId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
    const rows = await db
      .select()
      .from(tripWaitlistEntries)
      .where(
        and(eq(tripWaitlistEntries.shopId, shop.id), eq(tripWaitlistEntries.tripId, first.id)),
      );
    expect(rows).toEqual([]);
  });
});
