import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { fileScopedShopContext } from "@/test/db";
import { getDayCloseout } from "./closeout";
import { bookings as bookingsTable, people, rollCallEvents, trips as tripsTable } from "./schema";
import { listStaff } from "./trips";

const HOUR = 60 * 60 * 1000;
const ctx = fileScopedShopContext();

/**
 * **An abandoned after-dive count on a boat still out reads loud** (issue
 * #2925), through the db half: `listRollCallGaps` must carry the newest
 * mark's time onto the gap, or every open count at sea would read loud.
 */
describe("an open after-dive count at sea (#2925)", () => {
  it("reads an open count at sea loud once its newest mark is older than the quiet window (#2925)", async () => {
    // Through the plumbing: the db half must carry the newest mark's time
    // onto the gap, or every open count at sea would read loud.
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    const now = new Date(nowMs());
    const [trip] = await db
      .insert(tripsTable)
      .values({
        shopId: shop.id,
        title: "Half Counted — Molasses",
        startsAt: new Date(now.getTime() - 90 * 60 * 1000),
        endsAt: new Date(now.getTime() + 2 * HOUR),
        capacity: 12,
        plannedDives: 2,
        priceCents: 13000,
      })
      .returning();
    if (!trip) throw new Error("fixture trip insert returned no row");
    const divers = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(2);
    if (divers.length < 2) throw new Error("seed has too few people");
    const seats = await db
      .insert(bookingsTable)
      .values(
        divers.map((diver) => ({
          bookedAs: "diver" as const,
          shopId: shop.id,
          tripId: trip.id,
          personId: diver.id,
          status: "checked_in" as const,
        })),
      )
      .returning();
    const mark = (bookingId: string, checkpoint: string, occurredAt: Date) => ({
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: staff.person.id,
      status: "boarded" as const,
      checkpoint,
      source: "live" as const,
      occurredAt,
    });
    const [afterDiveOne] = rollCallCheckpoints(2).slice(1);
    if (!afterDiveOne) throw new Error("no after-dive checkpoint");
    // Both aboard at the dock; one of two marked back after dive 1, five
    // minutes ago, and nobody since.
    const markedAt = new Date(now.getTime() - 5 * 60 * 1000);
    await db
      .insert(rollCallEvents)
      .values([
        ...seats.map((booking) => mark(booking.id, "departure", trip.startsAt)),
        mark(seats[0]?.id ?? "", afterDiveOne, markedAt),
      ]);

    const statusAt = async (at: Date) =>
      (await getDayCloseout(db, shop.id, shop.timezone, at)).departures.find(
        (d) => d.tripId === trip.id,
      );
    const counting = await statusAt(now);
    expect([counting?.status, counting?.diveNumber]).toEqual(["still_out", 1]);
    const abandoned = await statusAt(new Date(markedAt.getTime() + 20 * 60 * 1000));
    expect([abandoned?.status, abandoned?.gapReason]).toEqual([
      "unreconciled",
      "after_dive_uncounted",
    ]);
  });
});
