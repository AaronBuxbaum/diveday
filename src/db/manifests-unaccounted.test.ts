import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { listUnaccountedForByTrip } from "./manifests";
import { bookings as bookingsTable, rollCallEvents } from "./schema";
import { boardAtDeparture, HOUR, returnedTrip } from "./today-roll-call-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **Who the crew have not counted back aboard** (issue #2404): the seats that
 * keep a departure from reading as finished. A safety read, so the cases are
 * the ones that could hide a diver (a later count, a retraction, a correction,
 * the dock) and the ones that could invent one (a cleared mis-tap, a
 * cancelled seat, another boat).
 */

async function boat(divers = 3, plannedDives = 2) {
  const { db, shop } = ctx;
  const made = await returnedTrip(db, shop.id, { endedHoursAgo: 1, divers, plannedDives });
  await boardAtDeparture(db, {
    shopId: shop.id,
    tripId: made.trip.id,
    staffId: made.staffId,
    bookingIds: made.bookingIds,
  });
  let minute = 0;
  /** One roll-call event, each a minute after the last so the newest is the one written last. */
  const say = async (
    bookingId: string,
    checkpoint: "departure" | "after_dive_1" | "after_dive_2",
    status: "boarded" | "not_boarded" | "cleared",
    tripId = made.trip.id,
  ) => {
    minute += 1;
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId,
      bookingId,
      recordedByPersonId: made.staffId,
      status,
      checkpoint,
      source: "live",
      occurredAt: new Date(nowMs() - HOUR + minute * 60_000),
    });
  };
  const unaccounted = async () =>
    [...((await listUnaccountedForByTrip(db, shop.id, [made.trip.id])).get(made.trip.id) ?? [])]
      .sort()
      .map((id) => made.bookingIds.indexOf(id));
  return { ...made, say, unaccounted };
}

describe("listUnaccountedForByTrip", () => {
  it("holds a seat recorded not back aboard at an after-dive checkpoint", async () => {
    const { bookingIds, say, unaccounted } = await boat();
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[1] as string, "after_dive_1", "boarded");
    expect(await unaccounted()).toEqual([0]);
  });

  it("keeps holding it when nobody has spoken for the seat at the next checkpoint", async () => {
    const { bookingIds, say, unaccounted } = await boat();
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    // The rest of the boat is counted at dive 2; the missing diver is not named, so is not back.
    await say(bookingIds[1] as string, "after_dive_2", "boarded");
    expect(await unaccounted()).toEqual([0]);
  });

  it("lets a later count aboard clear it, and only a later one", async () => {
    const { bookingIds, say, unaccounted } = await boat();
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[0] as string, "after_dive_2", "boarded");
    expect(await unaccounted()).toEqual([]);
    // Missing at the later count, counted at the earlier one: the latest word is missing.
    await say(bookingIds[1] as string, "after_dive_1", "boarded");
    await say(bookingIds[1] as string, "after_dive_2", "not_boarded");
    expect(await unaccounted()).toEqual([1]);
  });

  it("is cleared by a correction at the same checkpoint, newest word wins", async () => {
    const { bookingIds, say, unaccounted } = await boat();
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[0] as string, "after_dive_1", "boarded");
    expect(await unaccounted()).toEqual([]);
    // And the other way round: a diver counted aboard then found not to be is missing.
    await say(bookingIds[1] as string, "after_dive_1", "boarded");
    await say(bookingIds[1] as string, "after_dive_1", "not_boarded");
    expect(await unaccounted()).toEqual([1]);
  });

  it("is cleared by a retraction of a mis-tapped not-back, and not by the retraction of an older word", async () => {
    const { bookingIds, say, unaccounted } = await boat();
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[0] as string, "after_dive_1", "cleared");
    expect(await unaccounted()).toEqual([]);
    // A retraction at dive 2 drops dive 2 out; the dive 1 word still stands.
    await say(bookingIds[1] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[1] as string, "after_dive_2", "boarded");
    await say(bookingIds[1] as string, "after_dive_2", "cleared");
    expect(await unaccounted()).toEqual([1]);
  });

  it("never reads the dock: a diver who never left is not missing", async () => {
    const { bookingIds, say, unaccounted } = await boat();
    await say(bookingIds[0] as string, "departure", "not_boarded");
    expect(await unaccounted()).toEqual([]);
  });

  it("leaves out a cancelled seat, and another boat's", async () => {
    const { db, shop } = ctx;
    const { trip, bookingIds, staffId, say, unaccounted } = await boat();
    const other = await returnedTrip(db, shop.id, {
      endedHoursAgo: 1,
      divers: 1,
      plannedDives: 1,
      title: "Another boat",
    });
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[1] as string, "after_dive_1", "not_boarded");
    await say(other.bookingIds[0] as string, "after_dive_1", "not_boarded", other.trip.id);
    await db
      .update(bookingsTable)
      .set({ status: "cancelled" })
      .where(and(eq(bookingsTable.id, bookingIds[1] as string)));
    expect(await unaccounted()).toEqual([0]);

    const both = await listUnaccountedForByTrip(db, shop.id, [trip.id, other.trip.id]);
    expect([...(both.get(other.trip.id) ?? [])]).toEqual([other.bookingIds[0]]);
    // Another shop's trips are never read through this shop's id.
    expect((await listUnaccountedForByTrip(db, staffId, [trip.id])).size).toBe(0);
    void cancelBooking;
  });

  it("answers nothing for no trips without a read", async () => {
    expect((await listUnaccountedForByTrip(ctx.db, ctx.shop.id, [])).size).toBe(0);
  });
});
