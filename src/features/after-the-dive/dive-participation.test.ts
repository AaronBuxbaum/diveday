import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { getTripManifest } from "@/db/manifests";
import { bookings, diveParticipationNotes, rollCallEvents, shops } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { fileScopedShopContext } from "@/test/db";
import {
  diveParticipationForTrip,
  recordDiveParticipation,
  satOutDives,
} from "./dive-participation";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function noteContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const captain = (await listStaff(db, shop.id))[0]?.person;
  if (!captain) throw new Error("demo staff missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Sam Sitout",
      email: "sat-out-note@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0]?.bookingId;
  if (!bookingId) throw new Error("booking missing");
  const base = {
    shopId: shop.id,
    tripId: reef.id,
    bookingId,
    recordedByPersonId: captain.id,
  };
  return { db, shop, reef, captain, bookingId, base };
}

describe("dive participation notes (in-memory PGlite)", () => {
  it("refuses a note on a cancelled seat", async () => {
    const { db, bookingId, base } = await noteContext();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    expect(
      await recordDiveParticipation(db, { ...base, diveNumber: 1, participation: "sat_out" }),
    ).toEqual({ ok: false, reason: "seat_not_found" });
  });

  it("reads no note as unknown, never as did not dive", async () => {
    const { db, shop, reef, bookingId } = await noteContext();
    expect((await diveParticipationForTrip(db, shop.id, reef.id)).get(bookingId)).toBeUndefined();
    expect((await satOutDives(db, shop.id, reef.id, bookingId)).size).toBe(0);
  });

  it("keeps sat out, dived and unknown apart, and the newest word is the note", async () => {
    const { db, shop, reef, bookingId, base } = await noteContext();
    expect(
      await recordDiveParticipation(db, { ...base, diveNumber: 1, participation: "dived" }),
    ).toEqual({ ok: true });
    expect(
      await recordDiveParticipation(db, { ...base, diveNumber: 2, participation: "sat_out" }),
    ).toEqual({ ok: true });
    let seat = (await diveParticipationForTrip(db, shop.id, reef.id)).get(bookingId);
    expect(seat?.get(1)).toBe("dived");
    expect(seat?.get(2)).toBe("sat_out");
    expect([...(await satOutDives(db, shop.id, reef.id, bookingId))]).toEqual([2]);

    // They changed their mind and went in after all: the crew corrects it.
    await recordDiveParticipation(db, { ...base, diveNumber: 2, participation: "dived" });
    expect((await satOutDives(db, shop.id, reef.id, bookingId)).size).toBe(0);

    // A mis-tap taken back is unknown again, not "did not dive".
    await recordDiveParticipation(db, { ...base, diveNumber: 2, participation: "unknown" });
    seat = (await diveParticipationForTrip(db, shop.id, reef.id)).get(bookingId);
    expect(seat?.get(2)).toBe("unknown");
    expect((await satOutDives(db, shop.id, reef.id, bookingId)).size).toBe(0);
  });

  it("leaves the head count and every roll-call event exactly as they were", async () => {
    const { db, shop, reef, base } = await noteContext();
    const before = await getTripManifest(db, shop.id, reef.id, "after_dive_2");
    const eventsBefore = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, reef.id));
    await recordDiveParticipation(db, { ...base, diveNumber: 2, participation: "sat_out" });
    const after = await getTripManifest(db, shop.id, reef.id, "after_dive_2");
    expect(after?.summary).toEqual(before?.summary);
    expect(after?.completeness).toEqual(before?.completeness);
    expect(
      await db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, reef.id)),
    ).toEqual(eventsBefore);
  });

  it("refuses a dive the departure does not plan, and a state it does not know", async () => {
    const { db, shop, reef, bookingId, base } = await noteContext();
    for (const diveNumber of [0, -1, 1.5, reef.plannedDives + 1]) {
      expect(
        await recordDiveParticipation(db, { ...base, diveNumber, participation: "sat_out" }),
      ).toEqual({ ok: false, reason: "dive_invalid" });
    }
    expect(
      await recordDiveParticipation(db, {
        ...base,
        diveNumber: 1,
        participation: "maybe" as never,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect((await diveParticipationForTrip(db, shop.id, reef.id)).get(bookingId)).toBeUndefined();
  });

  it("refuses another shop's departure, staff and seat, and never reads across shops", async () => {
    const { db, shop, reef, bookingId, base } = await noteContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-sat-out-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const note = { ...base, diveNumber: 1, participation: "sat_out" as const };
    // A staffer of this shop writing under the other shop's id.
    expect(await recordDiveParticipation(db, { ...note, shopId: otherShop.id })).toEqual({
      ok: false,
      reason: "staff_not_found",
    });
    // A seat that is not on this departure.
    expect(
      await recordDiveParticipation(db, {
        ...note,
        bookingId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "seat_not_found" });
    expect(
      await recordDiveParticipation(db, {
        ...note,
        tripId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "trip_not_found" });

    await recordDiveParticipation(db, note);
    expect((await diveParticipationForTrip(db, otherShop.id, reef.id)).size).toBe(0);
    expect((await satOutDives(db, otherShop.id, reef.id, bookingId)).size).toBe(0);
    expect((await satOutDives(db, shop.id, reef.id, bookingId)).has(1)).toBe(true);
  });

  it("takes the row written last as the note when two share a timestamp", async () => {
    const { db, shop, reef, bookingId, base } = await noteContext();
    const at = new Date("2026-07-21T15:00:00Z");
    // `recorded_at` ties under a frozen clock; `seq` decides, newest wins.
    await db.insert(diveParticipationNotes).values([
      { ...base, diveNumber: 1, participation: "sat_out", recordedAt: at },
      { ...base, diveNumber: 1, participation: "dived", recordedAt: at },
    ]);
    expect((await diveParticipationForTrip(db, shop.id, reef.id)).get(bookingId)?.get(1)).toBe(
      "dived",
    );
    expect((await satOutDives(db, shop.id, reef.id, bookingId)).size).toBe(0);
    await db
      .insert(diveParticipationNotes)
      .values({ ...base, diveNumber: 1, participation: "sat_out", recordedAt: at });
    expect([...(await satOutDives(db, shop.id, reef.id, bookingId))]).toEqual([1]);
  });
});
