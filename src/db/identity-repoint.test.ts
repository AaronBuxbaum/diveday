// @vitest-environment node
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { otherSameNamePeople, repointHeldBooking } from "./identity-repoint";
import { listTripActivity, pagedDiverActivity } from "./operations";
import { getBookingReadiness } from "./readiness";
import { bookings, people, shops, waiverRecords } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { issueWaiverRequest } from "./waivers";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **"It's another diver on file"** (issue #2129, Aaron 2026-10-13, option a):
 * a seat held because the shop holds two divers with one name is re-pointed
 * to the other record and **stays held**. Identity and personal data, so the
 * failure paths lead.
 */

let seq = 0;

async function person(db: AppDb, shopId: string, fullName: string) {
  seq += 1;
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName, email: `namesake-${seq}@example.com` })
    .returning({ id: people.id });
  if (!row) throw new Error("person insert failed");
  return row.id;
}

/** Two Alex Kims, and a seat held on the first under the same-name reason. */
async function namesakes(name = "Alex Kim") {
  const { db, shop } = ctx;
  const first = await person(db, shop.id, name);
  const second = await person(db, shop.id, ` ${name.toLowerCase()} `);
  const trips = await upcomingTripsWithCounts(db, shop.id, nowDate());
  const [trip, other] = trips.filter((row) => !row.courseId);
  if (!trip || !other) throw new Error("expected two seeded charters");
  const [owner] = await db.select({ email: people.email }).from(people).where(eq(people.id, first));
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: name,
    email: owner?.email ?? "",
  });
  if (!booked.ok || booked.personId !== first) throw new Error("seat not on the first namesake");
  await db
    .update(bookings)
    .set({
      identityUnconfirmedAt: nowDate(),
      identityBookedAs: name,
      identityMatchedBy: "picked_name",
    })
    .where(eq(bookings.id, booked.bookingId));
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("staff missing");
  return { db, shop, trip, other, first, second, bookingId: booked.bookingId, staff: staff.person };
}

describe("otherSameNamePeople", () => {
  it("offers the shop's other live namesakes, by name, only for the same-name reason", async () => {
    const { db, shop, first, second, bookingId } = await namesakes();
    const removed = await person(db, shop.id, "Alex Kim");
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, removed));

    const offered = await otherSameNamePeople(db, shop.id, [
      { bookingId, personId: first, bookedAs: "Alex Kim" },
      // Booked as someone else entirely: the shared-email reason, not this one.
      { bookingId: "other-seat", personId: first, bookedAs: "Sam Kim" },
    ]);
    expect(offered.get(bookingId)).toEqual([{ personId: second, fullName: " alex kim " }]);
    expect(offered.has("other-seat")).toBe(false);
  });
});

describe("repointHeldBooking", () => {
  it("moves the seat to the other namesake and keeps it held", async () => {
    const { db, shop, trip, first, second, bookingId, staff } = await namesakes();
    const result = await repointHeldBooking(db, {
      shopId: shop.id,
      bookingId,
      actorPersonId: staff.id,
      toPersonId: second,
    });
    expect(result).toEqual({ ok: true, tripId: trip.id, seatIds: [bookingId] });

    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.personId).toBe(second);
    // Never a confirmation: the hold, its name and its reason all stand.
    expect(seat?.identityUnconfirmedAt).not.toBeNull();
    expect(seat?.identityBookedAs).toBe("Alex Kim");
    expect(seat?.identityMatchedBy).toBe("picked_name");
    const readiness = await getBookingReadiness(db, shop.id, bookingId);
    expect(readiness?.blockers.map((b) => b.code)).toContain("identity_unconfirmed");

    expect((await listTripActivity(db, shop.id, trip.id)).map((e) => e.code)).toContain(
      "identity_repointed",
    );
    const left = await pagedDiverActivity(db, shop.id, first, { page: 1 });
    expect(left.rows.map((e) => e.code)).toContain("identity_repointed_off");
    const onto = await pagedDiverActivity(db, shop.id, second, { page: 1 });
    expect(onto.rows.map((e) => e.code)).toContain("identity_repointed_onto");
  });

  it("supersedes the old match's release on the seat", async () => {
    const { db, shop, first, second, bookingId, staff } = await namesakes();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, bookingId));
    await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, bookingId));

    const result = await repointHeldBooking(db, {
      shopId: shop.id,
      bookingId,
      actorPersonId: staff.id,
      toPersonId: second,
    });
    expect(result.ok).toBe(true);
    const live = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, bookingId), isNull(waiverRecords.supersededAt)));
    expect(live).toEqual([]);
    const filed = await db
      .select({ personId: waiverRecords.personId, moved: waiverRecords.movedFromPersonId })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, bookingId));
    expect(filed.every((row) => row.personId === second && row.moved === first)).toBe(true);
  });

  it("refuses another shop's namesake", async () => {
    const { db, shop, bookingId, staff } = await namesakes();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-repoint", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("shop insert failed");
    const elsewhere = await person(db, other.id, "Alex Kim");

    expect(
      await repointHeldBooking(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        toPersonId: elsewhere,
      }),
    ).toEqual({ ok: false, reason: "person_unavailable" });
    // And the seat cannot be reached from the other shop either.
    expect(
      await repointHeldBooking(db, {
        shopId: other.id,
        bookingId,
        actorPersonId: staff.id,
        toPersonId: elsewhere,
      }),
    ).toEqual({ ok: false, reason: "not_held" });
  });

  it("refuses a removed namesake, someone of another name, and the same record", async () => {
    const { db, shop, first, bookingId, staff } = await namesakes();
    const removed = await person(db, shop.id, "Alex Kim");
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, removed));
    const stranger = await person(db, shop.id, "Alexa Kim");
    for (const toPersonId of [removed, stranger, first]) {
      expect(
        await repointHeldBooking(db, {
          shopId: shop.id,
          bookingId,
          actorPersonId: staff.id,
          toPersonId,
        }),
      ).toEqual({ ok: false, reason: "person_unavailable" });
    }
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.personId).toBe(first);
  });

  it("refuses a seat that is not held, or held for another reason", async () => {
    const { db, shop, second, bookingId, staff } = await namesakes();
    const input = { shopId: shop.id, bookingId, actorPersonId: staff.id, toPersonId: second };
    await db
      .update(bookings)
      .set({ identityBookedAs: "Sam Kim" })
      .where(eq(bookings.id, bookingId));
    expect(await repointHeldBooking(db, input)).toEqual({
      ok: false,
      reason: "person_unavailable",
    });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, identityBookedAs: null })
      .where(eq(bookings.id, bookingId));
    expect(await repointHeldBooking(db, input)).toEqual({ ok: false, reason: "not_held" });
  });

  it("refuses a seat on a medical hold, and moves nothing", async () => {
    const { db, shop, first, second, bookingId, staff } = await namesakes();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, bookingId));
    await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, bookingId));
    await db
      .update(waiverRecords)
      .set({ status: "medical_review", medicalReviewRequired: true })
      .where(eq(waiverRecords.bookingId, bookingId));

    expect(
      await repointHeldBooking(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        toPersonId: second,
      }),
    ).toEqual({ ok: false, reason: "medical_hold" });
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.personId).toBe(first);
  });

  it("refuses a namesake already on that departure", async () => {
    const { db, shop, trip, second, bookingId, staff } = await namesakes();
    const [owner] = await db
      .select({ email: people.email })
      .from(people)
      .where(eq(people.id, second));
    const theirs = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "alex kim",
      email: owner?.email ?? "",
    });
    if (!theirs.ok || theirs.personId !== second) throw new Error("setup failed");
    expect(
      await repointHeldBooking(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        toPersonId: second,
      }),
    ).toEqual({ ok: false, reason: "already_on_departure" });
  });

  it("moves the booker's other same-name held seats along when named", async () => {
    const { db, shop, other, first, second, bookingId, staff } = await namesakes();
    const [owner] = await db
      .select({ email: people.email })
      .from(people)
      .where(eq(people.id, first));
    const again = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: "Alex Kim",
      email: owner?.email ?? "",
    });
    if (!again.ok) throw new Error("setup failed");
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: nowDate(),
        identityBookedAs: "alex kim",
        identityMatchedBy: "picked_name",
      })
      .where(eq(bookings.id, again.bookingId));

    const result = await repointHeldBooking(db, {
      shopId: shop.id,
      bookingId,
      actorPersonId: staff.id,
      toPersonId: second,
      sameNameSeatIds: [again.bookingId],
    });
    expect(result).toMatchObject({ ok: true, seatIds: [bookingId, again.bookingId] });
    const moved = await db
      .select({ personId: bookings.personId, held: bookings.identityUnconfirmedAt })
      .from(bookings)
      .where(eq(bookings.personId, second));
    expect(moved).toHaveLength(2);
    expect(moved.every((row) => row.held !== null)).toBe(true);
  });
});
