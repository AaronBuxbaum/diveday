import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { listBookingNotes, listTripActivity } from "./operations";
import { getBookingReadiness } from "./readiness";
import { internalNotes } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * The Guests tab's history on today's reef boat (src/db/seed-desk-trail.ts).
 * The invariants worth holding are that the surface has something to show and
 * that showing it cannot have moved anything: notes and activity are
 * annotation, and the readiness other specs assert exactly must be untouched.
 */
async function reefTrip() {
  const { db, shop } = await seededShopContext({ history: true });
  // Today's boat — the first trip `seedTrips` inserts, and the departure the
  // desk trail is written against. Scanned from *now* rather than the epoch on
  // purpose: the history back-fill reuses these titles on trips that already
  // sailed, so a scan from the epoch finds a past one first.
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("seeded reef trip missing");
  return { db, shop, trip };
}

describe("seeded desk trail", () => {
  it("gives the Guests tab a trail to read instead of an empty state", async () => {
    const { db, shop, trip } = await reefTrip();
    const activity = await listTripActivity(db, shop.id, trip.id);
    expect(activity.length).toBeGreaterThan(0);
    // Newest first, and every line names the staffer who did the work — the
    // shape `recordTripActivity` writes, so the trail reads the same whether a
    // row was seeded or earned.
    const occurred = activity.map((event) => event.occurredAt.getTime());
    expect(occurred).toEqual([...occurred].sort((a, b) => b - a));
    for (const event of activity) expect(event.message).toMatch(/\w+ \w+ /);

    const notes = await listBookingNotes(db, shop.id, trip.id);
    expect(notes.length).toBeGreaterThan(0);
    // A note belongs to a seat on this trip and carries its author's name.
    for (const row of notes) {
      expect(row.note.bookingId).not.toBeNull();
      expect(row.authorName.length).toBeGreaterThan(0);
      expect(row.note.body.toLowerCase()).not.toContain("surgery");
    }
  });

  it("annotates without moving a single diver's readiness", async () => {
    const { db, shop, trip } = await reefTrip();
    const notes = await db.select().from(internalNotes).where(eq(internalNotes.shopId, shop.id));
    expect(notes.length).toBeGreaterThan(0);
    // The noted seats are as ready (or as blocked) as they would be with no
    // note at all: nothing in the readiness pipeline reads this table, and this
    // is the assertion that keeps it that way.
    for (const note of notes) {
      if (!note.bookingId) continue;
      const readiness = await getBookingReadiness(db, shop.id, note.bookingId);
      expect(readiness).not.toBeNull();
      expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain("internal_note");
    }
    expect(trip.booked).toBeGreaterThan(0);
  });
});
