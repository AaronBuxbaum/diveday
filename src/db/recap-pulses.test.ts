import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  getRecapPulseForBooking,
  listOpenRecapPulses,
  MAX_RECAP_PULSE_NOTE_LENGTH,
  markRecapPulseAddressed,
  submitRecapPulse,
} from "./recap-pulses";
import { bookings, people, recapPulses } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The private pulse** (D40, issue #1200) — the door beside the review that
 * says a thing the shop can fix, to the shop and nobody else.
 *
 * What these cases hold, in the order the surface exercises them: one live
 * pulse per booking however many times a diver taps Send; a withdrawal that
 * really frees the slot rather than leaving the diver locked out of their own
 * second thought; the check constraint the schema puts under both; the same
 * fail-closed answer to a booking that never dived that the review gives; and a
 * staff panel scoped to one shop that shows neither what has been dealt with
 * nor what has been taken back.
 */

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";

async function pulseContext(divers = ["Pulse Diver"]) {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const charter = trips.find(
    (trip) => !trip.course && trip.capacity - trip.booked >= divers.length,
  );
  if (!charter) throw new Error("demo charter missing");
  const party = await createBookingParty(
    db,
    divers.map((fullName, index) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: charter.id,
      fullName,
      email: `pulse-diver-${index}@example.com`,
    })),
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  return {
    db,
    shop,
    ownerId: owner.id,
    bookingIds: party.bookings.map((booking) => booking.bookingId),
  };
}

const rowsFor = (db: Awaited<ReturnType<typeof pulseContext>>["db"], bookingId: string) =>
  db.select().from(recapPulses).where(eq(recapPulses.bookingId, bookingId));

describe("submitRecapPulse", () => {
  it("files one pulse and reads it back as codes, never as a sentence", async () => {
    const { db, bookingIds } = await pulseContext();
    const result = await submitRecapPulse(db, {
      bookingId: bookingIds[0],
      categories: ["gear", "briefing"],
      note: "  The BCD inflator stuck twice.  ",
    });
    expect(result).toEqual({ ok: true, withdrawn: false });

    const own = await getRecapPulseForBooking(db, bookingIds[0]);
    expect(own).toEqual({
      categories: ["gear", "briefing"],
      note: "The BCD inflator stuck twice.",
    });
  });

  it("edits rather than duplicates when the diver sends a second time", async () => {
    const { db, bookingIds } = await pulseContext();
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["gear"] });
    await submitRecapPulse(db, {
      bookingId: bookingIds[0],
      categories: ["boat"],
      note: "No shade.",
    });

    expect(await rowsFor(db, bookingIds[0])).toHaveLength(1);
    expect(await getRecapPulseForBooking(db, bookingIds[0])).toEqual({
      categories: ["boat"],
      note: "No shade.",
    });
  });

  it("reopens an item a staffer had marked dealt with when the diver revises it", async () => {
    const { db, shop, ownerId, bookingIds } = await pulseContext();
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["gear"] });
    const [open] = await listOpenRecapPulses(db, shop.id);
    await markRecapPulseAddressed(db, shop.id, open.id, ownerId);
    expect(await listOpenRecapPulses(db, shop.id)).toHaveLength(0);

    // New words are a new thing to answer, not the old thing still closed.
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["timing"] });
    expect(await listOpenRecapPulses(db, shop.id)).toHaveLength(1);
  });

  it("caps the diver's own words rather than trusting the textarea", async () => {
    const { db, bookingIds } = await pulseContext();
    await submitRecapPulse(db, {
      bookingId: bookingIds[0],
      categories: ["other"],
      note: "x".repeat(MAX_RECAP_PULSE_NOTE_LENGTH + 200),
    });
    const own = await getRecapPulseForBooking(db, bookingIds[0]);
    expect(own?.note).toHaveLength(MAX_RECAP_PULSE_NOTE_LENGTH);
  });

  it("drops anything that is not one of the five codes", async () => {
    const { db, bookingIds } = await pulseContext();
    const result = await submitRecapPulse(db, {
      bookingId: bookingIds[0],
      // A crafted form, and the one real code in it is all that survives.
      categories: ["gear", "constructor", "__proto__", "refund"] as never,
    });
    expect(result).toEqual({ ok: true, withdrawn: false });
    expect(await getRecapPulseForBooking(db, bookingIds[0])).toEqual({
      categories: ["gear"],
      note: null,
    });
  });

  it("refuses a booking that never dived, and says which refusal it is", async () => {
    const { db, bookingIds } = await pulseContext();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingIds[0]));
    expect(await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["boat"] })).toEqual({
      ok: false,
      reason: "did_not_dive",
    });
    expect(await rowsFor(db, bookingIds[0])).toHaveLength(0);
  });

  it("refuses a booking id that resolves to nothing", async () => {
    const { db } = await pulseContext();
    expect(await submitRecapPulse(db, { bookingId: "not-a-uuid", categories: ["gear"] })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await submitRecapPulse(db, { bookingId: OTHER_SHOP_ID, categories: ["gear"] })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("taking it back", () => {
  it("withdraws a live pulse and lets the diver write a new one afterwards", async () => {
    const { db, shop, bookingIds } = await pulseContext();
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["gear"] });
    expect(await submitRecapPulse(db, { bookingId: bookingIds[0], categories: [] })).toEqual({
      ok: true,
      withdrawn: true,
    });

    // Soft, not gone: the row stays and the shop stops seeing it.
    const [withdrawn] = await rowsFor(db, bookingIds[0]);
    expect(withdrawn.deletedAt).not.toBeNull();
    expect(await getRecapPulseForBooking(db, bookingIds[0])).toBeNull();
    expect(await listOpenRecapPulses(db, shop.id)).toHaveLength(0);

    // The partial unique index is over the live rows only, so a second thought
    // inserts rather than colliding with the row that was taken back.
    expect(
      await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["timing"] }),
    ).toEqual({ ok: true, withdrawn: false });
    expect(await rowsFor(db, bookingIds[0])).toHaveLength(2);
    expect(await getRecapPulseForBooking(db, bookingIds[0])).toEqual({
      categories: ["timing"],
      note: null,
    });
  });

  it("answers `empty` when there was nothing to take back", async () => {
    const { db, bookingIds } = await pulseContext();
    expect(await submitRecapPulse(db, { bookingId: bookingIds[0], categories: [] })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(await rowsFor(db, bookingIds[0])).toHaveLength(0);
  });

  it("refuses a live row with no category at the database, not only in the writer", async () => {
    const { db, shop, bookingIds } = await pulseContext();
    const [booking] = await db
      .select({ tripId: bookings.tripId, personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingIds[0]))
      .limit(1);
    await expect(
      db.insert(recapPulses).values({
        shopId: shop.id,
        bookingId: bookingIds[0],
        tripId: booking.tripId,
        personId: booking.personId,
        categories: [],
      }),
    ).rejects.toThrow();
  });
});

describe("the shop's panel", () => {
  it("lists open items newest first and hides nothing that is still open", async () => {
    const { db, shop, bookingIds } = await pulseContext(["First Diver", "Second Diver"]);
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["gear"] });
    await submitRecapPulse(db, {
      bookingId: bookingIds[1],
      categories: ["boat"],
      note: "No shade.",
    });

    const open = await listOpenRecapPulses(db, shop.id);
    expect(open).toHaveLength(2);
    expect(open.map((row) => row.diverName).sort()).toEqual(["First Diver", "Second Diver"]);
    // Everything a row needs to be read and acted on, carried with it.
    expect(open[0]).toMatchObject({
      tripTitle: expect.any(String),
      personId: expect.any(String),
      tripId: expect.any(String),
    });
  });

  it("belongs to one shop", async () => {
    const { db, bookingIds } = await pulseContext();
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["gear"] });
    expect(await listOpenRecapPulses(db, OTHER_SHOP_ID)).toHaveLength(0);
  });

  it("drops a row once a staffer marks it addressed, and records who did", async () => {
    const { db, shop, ownerId, bookingIds } = await pulseContext();
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["timing"] });
    const [open] = await listOpenRecapPulses(db, shop.id);

    expect(await markRecapPulseAddressed(db, shop.id, open.id, ownerId)).toBe(true);
    expect(await listOpenRecapPulses(db, shop.id)).toHaveLength(0);
    const [row] = await rowsFor(db, bookingIds[0]);
    expect(row.addressedAt).not.toBeNull();
    expect(row.addressedByPersonId).toBe(ownerId);

    // Idempotent: a second tap on a phone is not a refusal.
    expect(await markRecapPulseAddressed(db, shop.id, open.id, ownerId)).toBe(true);
  });

  it("moves nothing when another shop's id is replayed against it", async () => {
    const { db, shop, ownerId, bookingIds } = await pulseContext();
    await submitRecapPulse(db, { bookingId: bookingIds[0], categories: ["gear"] });
    const [open] = await listOpenRecapPulses(db, shop.id);

    expect(await markRecapPulseAddressed(db, OTHER_SHOP_ID, open.id, ownerId)).toBe(false);
    expect(await listOpenRecapPulses(db, shop.id)).toHaveLength(1);
  });
});
