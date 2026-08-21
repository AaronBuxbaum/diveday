import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { DIVER_ACTIVITY_PAGE_SIZE, pagedDiverActivity } from "./operations";
import { getBookingReadiness } from "./readiness";
import { bookings, people } from "./schema";

/**
 * The desk trail seeded **per diver** (src/db/seed-diver-trail.ts). Two
 * invariants are worth holding, and they are the same two `seed-desk-trail`
 * holds: the surface has something to show, and showing it cannot have moved
 * anything — `activity_events` is annotation, and the readiness other specs
 * assert exactly must be untouched.
 */
async function diverId(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Priya Sharma")));
  if (!row) throw new Error("seeded diver missing");
  return row.id;
}

describe("seeded diver trail", () => {
  it("gives the diver record's Activity panel a history rather than an empty state", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await diverId(db, shop.id);

    const page = await pagedDiverActivity(db, shop.id, priya);
    expect(page.rows.length).toBe(DIVER_ACTIVITY_PAGE_SIZE);
    // Past one page on purpose: this is the record every visual baseline
    // photographs, so the section's pager has to be a rendered thing rather
    // than a claim.
    expect(page.pageCount).toBeGreaterThan(1);
    for (const row of page.rows) {
      // Every line names the staffer who did the work and the diver it was
      // about — the shape `recordTripActivity` writes, so the trail reads the
      // same whether a row was seeded or earned.
      expect(row.message).toContain("Priya Sharma");
      expect(row.message).toMatch(/^\w+ \w+ /);
      // Always in the past: "today at 09:00" is in the future for anyone who
      // opens the demo before the boat leaves.
      expect(row.occurredAt.getTime()).toBeLessThan(nowMs());
    }
  });

  it("annotates without moving a single diver's readiness", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await diverId(db, shop.id);
    const seats = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.personId, priya)));
    expect(seats.length).toBeGreaterThan(0);

    // The annotated seats are as ready (or as blocked) as they would be with no
    // activity line at all: nothing in the readiness pipeline reads this table,
    // and this is the assertion that keeps it that way.
    for (const seat of seats) {
      const readiness = await getBookingReadiness(db, shop.id, seat.id);
      expect(readiness).not.toBeNull();
      expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain("activity_event");
    }
  });
});
