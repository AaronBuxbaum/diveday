// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withholdHeldSeatParticulars } from "@/lib/held-seat";
import { serializeManifests } from "@/lib/offline-manifests";
import { fileScopedShopContext } from "@/test/db";
import { confirmBookingIdentity, createBooking, splitBookingIdentity } from "./bookings";
import { getTripManifest } from "./manifests";
import { bookings, people } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { saveBookingEmergencyContact } from "./waivers";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **The emergency contact for the person on a held seat** (issue #2145, Aaron
 * 2026-10-13, option b). The matched record's contact may be somebody else's
 * next of kin, so it is withheld from every crew surface; the desk records one
 * on the booking, which stands in its place while the seat is held and goes
 * onto the new record at a split. Nothing is written to the matched record
 * while the seat is held; at a confirm it is the same person, so the seat's
 * contact goes onto a record with none, and beside a different one the staffer
 * picks (dive-domain review H3). Failure paths first: emergency contacts on a
 * manifest are safety-critical, and they are personal data.
 */

let seq = 0;

/** Marisol, with her sister on file, and a seat booked on her email as Lucia. */
async function heldSeat(options: { recordContact?: boolean } = {}) {
  const { db, shop } = ctx;
  const recordContact = options.recordContact ?? true;
  seq += 1;
  const email = `marisol-${seq}@example.com`;
  const [marisol] = await db
    .insert(people)
    .values({
      shopId: shop.id,
      fullName: "Marisol Vega",
      email,
      emergencyContactName: recordContact ? "Pilar Vega" : null,
      emergencyContactPhone: recordContact ? "+34 600 111 222" : null,
    })
    .returning({ id: people.id });
  if (!marisol) throw new Error("person insert failed");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((row) => !row.courseId && row.booked < row.capacity);
  if (!trip) throw new Error("no open charter");
  const seat = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Lucia Vega",
    email,
  });
  if (!seat.ok || seat.personId !== marisol.id) throw new Error("seat not matched to Marisol");
  const [row] = await db.select().from(bookings).where(eq(bookings.id, seat.bookingId));
  if (!row?.identityUnconfirmedAt) throw new Error("seat not held");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("staff missing");
  return { db, shop, trip, marisol: marisol.id, bookingId: seat.bookingId, staff: staff.person };
}

async function manifestRow(bookingId: string, tripId: string) {
  const { db, shop } = ctx;
  const manifest = await getTripManifest(db, shop.id, tripId);
  const row = manifest?.divers.find((diver) => diver.bookingId === bookingId);
  if (!manifest || !row) throw new Error("manifest row missing");
  return { manifest, row };
}

describe("a held seat's emergency contact", () => {
  it("never shows the matched record's contact, with none recorded on the seat", async () => {
    const { trip, bookingId } = await heldSeat();
    const { row } = await manifestRow(bookingId, trip.id);
    const shown = withholdHeldSeatParticulars(row);
    expect(shown.emergencyContactName).toBeNull();
    expect(shown.emergencyContactPhone).toBeNull();
  });

  it("writes the desk's contact on the booking, never on the matched record", async () => {
    const { db, shop, marisol, bookingId } = await heldSeat();
    expect(
      await saveBookingEmergencyContact(db, {
        shopId: shop.id,
        bookingId,
        name: "Rosa Vega",
        phone: "+34 600 333 444",
        actor: "staff",
      }),
    ).toBe(true);
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect([seat?.heldEmergencyContactName, seat?.heldEmergencyContactPhone]).toEqual([
      "Rosa Vega",
      "+34 600 333 444",
    ]);
    const [record] = await db.select().from(people).where(eq(people.id, marisol));
    expect([record?.emergencyContactName, record?.emergencyContactPhone]).toEqual([
      "Pilar Vega",
      "+34 600 111 222",
    ]);
  });

  it("refuses a bearer link and a half-filled pair, writing nothing anywhere", async () => {
    const { db, shop, marisol, bookingId } = await heldSeat();
    expect(
      await saveBookingEmergencyContact(db, {
        shopId: shop.id,
        bookingId,
        name: "Rosa Vega",
        phone: "+34 600 333 444",
        actor: "bearer",
      }),
    ).toBe(false);
    expect(
      await saveBookingEmergencyContact(db, {
        shopId: shop.id,
        bookingId,
        name: "Rosa Vega",
        actor: "staff",
      }),
    ).toBe(false);
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.heldEmergencyContactName).toBeNull();
    const [record] = await db.select().from(people).where(eq(people.id, marisol));
    expect(record?.emergencyContactName).toBe("Pilar Vega");
  });

  it("shows the seat's own contact on the manifest and the crew phone's copy in place of the withheld one", async () => {
    const { db, shop, trip, bookingId } = await heldSeat();
    await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId,
      name: "Rosa Vega",
      phone: "+34 600 333 444",
      actor: "staff",
    });
    const { manifest, row } = await manifestRow(bookingId, trip.id);
    const shown = withholdHeldSeatParticulars(row);
    expect(shown.identityWithheld).toBe(true);
    // Its own field, so no surface can mistake it for the record's (H7, Y3).
    expect([shown.emergencyContactName, shown.emergencyContactPhone]).toEqual([null, null]);
    expect(shown.heldEmergencyContact).toEqual({ name: "Rosa Vega", phone: "+34 600 333 444" });

    const saved = JSON.stringify(
      serializeManifests(
        [manifest],
        { slug: shop.slug, name: shop.name, timezone: shop.timezone },
        (blocker) => blocker.code,
      ),
    );
    expect(saved).toContain("Rosa Vega");
    expect(saved).not.toContain("Pilar Vega");
    expect(saved).not.toContain("+34 600 111 222");
  });

  it("goes onto the new record at a split, and off the booking", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat();
    await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId,
      name: "Rosa Vega",
      phone: "+34 600 333 444",
      actor: "staff",
    });
    const split = await splitBookingIdentity(db, {
      shopId: shop.id,
      bookingId,
      actorPersonId: staff.id,
      fullName: "Lucia Vega",
      adultAttested: true,
    });
    if (!split.ok) throw new Error(`split refused: ${split.reason}`);
    const [lucia] = await db.select().from(people).where(eq(people.id, split.personId));
    expect([lucia?.emergencyContactName, lucia?.emergencyContactPhone]).toEqual([
      "Rosa Vega",
      "+34 600 333 444",
    ]);
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.heldEmergencyContactName).toBeNull();
    expect(seat?.heldEmergencyContactPhone).toBeNull();
    const [record] = await db.select().from(people).where(eq(people.id, marisol));
    expect(record?.emergencyContactName).toBe("Pilar Vega");
  });

  /** The desk's contact for the person on the seat, recorded while it is held. */
  async function recordHeld(bookingId: string, name = "Rosa Vega", phone = "+34 600 333 444") {
    const { db, shop } = ctx;
    await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId,
      name,
      phone,
      actor: "staff",
    });
  }

  async function contacts(bookingId: string, personId: string) {
    const { db } = ctx;
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const [record] = await db.select().from(people).where(eq(people.id, personId));
    return { seat, record };
  }

  it("refuses a confirm that would drop a differing contact, until the staffer picks one", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat();
    await recordHeld(bookingId);
    expect(
      await confirmBookingIdentity(db, { shopId: shop.id, bookingId, actorPersonId: staff.id }),
    ).toBe("contact_differs");
    const { seat, record } = await contacts(bookingId, marisol);
    expect(seat?.identityUnconfirmedAt).not.toBeNull();
    expect(seat?.heldEmergencyContactName).toBe("Rosa Vega");
    expect(record?.emergencyContactName).toBe("Pilar Vega");
  });

  it("puts the seat's contact on the record when the staffer picks it", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat();
    await recordHeld(bookingId);
    expect(
      await confirmBookingIdentity(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        heldContact: "use_held",
      }),
    ).toBe(true);
    const { seat, record } = await contacts(bookingId, marisol);
    expect(seat?.identityUnconfirmedAt).toBeNull();
    expect(seat?.heldEmergencyContactName).toBeNull();
    expect(record?.emergencyContactName).toBe("Rosa Vega");
    expect(record?.emergencyContactPhone).toBe("+34 600 333 444");
  });

  it("keeps the record's contact when the staffer picks it", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat();
    await recordHeld(bookingId);
    expect(
      await confirmBookingIdentity(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        heldContact: "keep_record",
      }),
    ).toBe(true);
    const { seat, record } = await contacts(bookingId, marisol);
    expect(seat?.heldEmergencyContactName).toBeNull();
    expect(record?.emergencyContactName).toBe("Pilar Vega");
  });

  it("copies the seat's contact onto a record that has none", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat({ recordContact: false });
    await recordHeld(bookingId);
    expect(
      await confirmBookingIdentity(db, { shopId: shop.id, bookingId, actorPersonId: staff.id }),
    ).toBe(true);
    const { record } = await contacts(bookingId, marisol);
    expect(record?.emergencyContactName).toBe("Rosa Vega");
    expect(record?.emergencyContactPhone).toBe("+34 600 333 444");
  });

  it("asks nothing when the seat's contact is the record's", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat();
    await recordHeld(bookingId, "Pilar Vega", "+34 600 111 222");
    expect(
      await confirmBookingIdentity(db, { shopId: shop.id, bookingId, actorPersonId: staff.id }),
    ).toBe(true);
    const { record } = await contacts(bookingId, marisol);
    expect(record?.emergencyContactName).toBe("Pilar Vega");
  });

  it("leaves the record's contact alone when the seat recorded none", async () => {
    const { db, shop, marisol, bookingId, staff } = await heldSeat();
    expect(
      await confirmBookingIdentity(db, { shopId: shop.id, bookingId, actorPersonId: staff.id }),
    ).toBe(true);
    const { record } = await contacts(bookingId, marisol);
    expect(record?.emergencyContactName).toBe("Pilar Vega");
  });

  /** A second seat booked as Lucia on Marisol's email, on another charter. */
  async function siblingSeat(tripId: string, email: string) {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const other = trips.find(
      (row) => !row.courseId && row.id !== tripId && row.booked < row.capacity,
    );
    if (!other) throw new Error("no second open charter");
    const seat = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: "Lucia Vega",
      email,
    });
    if (!seat.ok) throw new Error("second seat refused");
    return seat.bookingId;
  }

  async function heldPair() {
    const held = await heldSeat();
    const [record] = await ctx.db.select().from(people).where(eq(people.id, held.marisol));
    if (!record?.email) throw new Error("record email missing");
    return { ...held, sibling: await siblingSeat(held.trip.id, record.email) };
  }

  it("carries a contact recorded on any moving seat onto the new record", async () => {
    const { db, shop, bookingId, sibling, staff } = await heldPair();
    await recordHeld(sibling);
    const split = await splitBookingIdentity(db, {
      shopId: shop.id,
      bookingId,
      actorPersonId: staff.id,
      fullName: "Lucia Vega",
      adultAttested: true,
      sameNameSeatIds: [sibling],
    });
    if (!split.ok) throw new Error(`split refused: ${split.reason}`);
    expect(split.seats).toBe(2);
    const [lucia] = await db.select().from(people).where(eq(people.id, split.personId));
    expect(lucia?.emergencyContactName).toBe("Rosa Vega");
  });

  it("refuses a split whose moving seats hold different contacts", async () => {
    const { db, shop, marisol, bookingId, sibling, staff } = await heldPair();
    await recordHeld(bookingId);
    await recordHeld(sibling, "Ines Vega", "+34 600 555 666");
    const split = await splitBookingIdentity(db, {
      shopId: shop.id,
      bookingId,
      actorPersonId: staff.id,
      fullName: "Lucia Vega",
      adultAttested: true,
      sameNameSeatIds: [sibling],
    });
    expect(split).toEqual({ ok: false, reason: "held_contact_conflict" });
    const { seat } = await contacts(bookingId, marisol);
    expect(seat?.personId).toBe(marisol);
    expect(seat?.heldEmergencyContactName).toBe("Rosa Vega");
  });

  it("refuses a name without a number at the column, whatever the writer", async () => {
    const { db, bookingId } = await heldSeat();
    // In a savepoint of its own, so the refusal leaves the test's transaction usable.
    await expect(
      db.transaction((tx) =>
        tx
          .update(bookings)
          .set({ heldEmergencyContactName: "Rosa Vega" })
          .where(eq(bookings.id, bookingId)),
      ),
    ).rejects.toThrow();
  });
});
