// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { mergeDiverRecords } from "./diver-merge";
import { bookings, people, personRoles } from "./schema";
import { issuePartySeatClaims, openMinorSeatWaiver } from "./seat-claims";
import { upcomingTripsWithCounts } from "./trips";

/**
 * The parent's door opens only on a person this booking made, and the record
 * says so: `people.created_by_booking_id` (issue #2665, decided by Aaron
 * 2026-10-17). The rest of the parent-signs layer is in `seat-claims.test.ts`.
 */
const ctx = fileScopedShopContext();

/** The person a seat is booked to. */
async function personOfSeat(db: AppDb, bookingId: string): Promise<string> {
  const [seat] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!seat) throw new Error("seat missing");
  return seat.personId;
}

/** A lead parent, their declared-minor child, and an adult friend, on the seeded reef trip. */
async function familyParty() {
  const { db, shop } = ctx;
  const open = (await upcomingTripsWithCounts(db, shop.id)).find(
    (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!open) throw new Error("expected seeded trip missing");
  const outcome = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Dana Parent",
      email: "dana.parent@example.com",
    },
    {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Mia Child",
      minorDeclared: true,
    },
    { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Lee Friend" },
  ]);
  if (!outcome.ok) throw new Error(`party booking failed: ${outcome.reason}`);
  const [lead, mia, lee] = outcome.bookings;
  if (!lead || !mia || !lee) throw new Error("party booking incomplete");
  return { db, shop, open, lead, mia, lee };
}

describe("a seat's person stamped with the booking that made it (issue #2665)", () => {
  /**
   * Issue #2665 (dive-domain review N3 of the parent-signs layer): a record the
   * contact importer made has no email, no date of birth, no booking and no
   * release, so it passed the history test. Merged onto, it is still a record
   * the shop imported, not one this booking made, and the lead signs nothing
   * for it.
   */
  it("never opens one after a merge points the seat at an imported record with no history", async () => {
    const { db, shop, lead, mia } = await familyParty();
    const [imported] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Mia Child" })
      .returning();
    if (!imported) throw new Error("imported person insert failed");
    await db.insert(personRoles).values({ personId: imported.id, role: "diver" });
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: await personOfSeat(db, mia.bookingId),
        survivorId: imported.id,
        actorPersonId: owner.id,
      }),
    ).toMatchObject({ ok: true });
    expect(await personOfSeat(db, mia.bookingId)).toBe(imported.id);
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    expect(seats.find((seat) => seat.bookingId === mia.bookingId)?.signForMinor).toBe(false);
    expect(
      await openMinorSeatWaiver(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        seatBookingId: mia.bookingId,
      }),
    ).toEqual({ ok: false });
  });

  it("stamps a name-only seat's new person with the booking that made it", async () => {
    const { db, mia } = await familyParty();
    const [row] = await db
      .select({ createdByBookingId: people.createdByBookingId })
      .from(people)
      .where(eq(people.id, await personOfSeat(db, mia.bookingId)));
    expect(row?.createdByBookingId).toBe(mia.bookingId);
  });
});
