// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { markArrived } from "@/test/arrivals";
import { fileScopedShopContext } from "@/test/db";
import { seatCheckedIn } from "./arrival-provenance";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * The deploy-time backfill of `bookings.arrival_trail_after_seq` (issue #2702,
 * security review F1). Before the deploy a seat brought back to `booked`
 * (Remove undone, a cancelled row rebooked, a move away and back) kept its old
 * `arrived` row; read from the trail alone it would be checked in, and the
 * desk's next tap would skip readiness as a duplicate. `createTestDb()` has
 * already applied every migration, so the test runs the backfill's own
 * statements over rows written the old way.
 */
const ctx = fileScopedShopContext();

function statements(suffix: string): string[] {
  const dir = path.join(process.cwd(), "drizzle");
  const folder = readdirSync(dir).find((name) => name.endsWith(suffix));
  if (!folder) throw new Error(`migration ${suffix} is missing`);
  return readFileSync(path.join(dir, folder, "migration.sql"), "utf8").split(
    "--> statement-breakpoint",
  );
}

async function runBackfill() {
  // The holding table and its fill; the `checked_in` rewrite after them names
  // an enum value the test database no longer has.
  const [create, fill] = statements("_arrival-leaves-the-seat-word");
  // The column exists already; then the write and the holding table's drop.
  const [, write, drop] = statements("_arrival-trail-after-seq");
  for (const statement of [create, fill, write, drop]) {
    if (statement?.trim()) await ctx.db.execute(sql.raw(statement));
  }
}

async function checkedIn(bookingId: string) {
  const [row] = await ctx.db
    .select({ checkedIn: seatCheckedIn })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.checkedIn;
}

describe("arrival_trail_after_seq backfill", () => {
  it("starts a fresh trail on a booked seat whose old arrival still stands, and only there", async () => {
    const { db, shop } = ctx;
    const [reef] = await upcomingTripsWithCounts(db, shop.id);
    if (!reef) throw new Error("seeded trip missing");
    const [staff] = await listStaff(db, shop.id);
    const roster = await getTripRoster(db, shop.id, reef.id);
    const [reopened, cleared, untouched] = roster;
    if (!staff || !reopened || !cleared || !untouched) throw new Error("seeded seats missing");
    await db.update(bookings).set({ arrivalTrailAfterSeq: null });

    // Restored the old way: still `booked`, trail ending in `arrived`.
    await markArrived(db, reopened.booking.id, { recordedByPersonId: staff.person.id });
    // Checked in and undone: the trail's own word already says not here.
    await markArrived(db, cleared.booking.id, { recordedByPersonId: staff.person.id });
    await markArrived(db, cleared.booking.id, {
      recordedByPersonId: staff.person.id,
      status: "cleared",
    });
    expect(await checkedIn(reopened.booking.id)).toBe(true);

    await runBackfill();

    expect(await checkedIn(reopened.booking.id)).toBe(false);
    const after = await db
      .select({ id: bookings.id, after: bookings.arrivalTrailAfterSeq })
      .from(bookings)
      .where(eq(bookings.tripId, reef.id));
    const byId = new Map(after.map((row) => [row.id, row.after]));
    expect(byId.get(reopened.booking.id)).toEqual(expect.any(Number));
    expect(byId.get(cleared.booking.id)).toBeNull();
    expect(byId.get(untouched.booking.id)).toBeNull();
    // The next tap after the deploy is a new arrival, read again.
    await markArrived(db, reopened.booking.id, { recordedByPersonId: staff.person.id });
    expect(await checkedIn(reopened.booking.id)).toBe(true);
  });
});
