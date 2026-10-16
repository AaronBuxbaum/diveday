import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { DIETARY_NOTE_RETENTION_DAYS } from "@/lib/retention";
import { fileScopedShopContext } from "@/test/db";
import { clearExpiredDietaryNotes, pruneExpiredRecords } from "./retention";
import { bookings, people, trips } from "./schema";

const ctx = fileScopedShopContext();

/**
 * **A lunch note does not outlive its boat** (item 56; security review N5):
 * the nightly pass nulls it once the departure is more than
 * `DIETARY_NOTE_RETENTION_DAYS` behind, and leaves the booking itself alone.
 */
describe("clearExpiredDietaryNotes", () => {
  it("clears the note from a seat whose boat sailed past the window, and keeps a recent one", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const departure = async (title: string, daysAgo: number) => {
      const startsAt = new Date(now.getTime() - daysAgo * DAY_MS);
      const [row] = await db
        .insert(trips)
        .values({
          shopId: shop.id,
          title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          capacity: 6,
          lunchAboard: true,
        })
        .returning();
      return row;
    };
    const old = await departure("Old lunch boat", DIETARY_NOTE_RETENTION_DAYS + 1);
    const recent = await departure("Recent lunch boat", DIETARY_NOTE_RETENTION_DAYS - 1);
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Lunch Keeper" })
      .returning();
    const [oldSeat, recentSeat] = await db
      .insert(bookings)
      .values(
        [old, recent].map((trip) => ({
          bookedAs: "diver" as const,
          shopId: shop.id,
          tripId: trip.id,
          personId: diver.id,
          dietaryNote: "Vegetarian",
        })),
      )
      .returning();

    expect(await clearExpiredDietaryNotes(db, now)).toBeGreaterThanOrEqual(1);
    const note = async (id: string) =>
      (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
    expect((await note(oldSeat.id))?.dietaryNote).toBeNull();
    expect((await note(oldSeat.id))?.status).toBe(oldSeat.status);
    expect((await note(recentSeat.id))?.dietaryNote).toBe("Vegetarian");

    // The nightly pass runs it too, and a second run finds nothing more.
    const summary = await pruneExpiredRecords(db, { now });
    expect(summary.dietaryNotesCleared).toBe(0);
  });
});
