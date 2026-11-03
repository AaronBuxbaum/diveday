import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { ReadinessResult } from "@/lib/readiness";
import { fileScopedShopContext } from "@/test/db";
import { departureCounts } from "./departure-counts";
import { listDepartureBoardedByTrip, listUnaccountedForByTrip } from "./manifests";
import { listTripsReadiness } from "./readiness";
import { bookings as bookingsTable, rollCallEvents, trips as tripsTable } from "./schema";
import { HOUR, returnedTrip } from "./today-roll-call-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **One departure's head count** (issue #2785). A safety read, so the cases are
 * the ones that could send a diver home in the count while they are still in
 * the water (a missing diver, one nobody has named yet, a retracted word), and
 * the ones that could invent a diver (a no-show, a cancelled seat, a diver who
 * never left the dock, another boat).
 */

/** A string, so a test can write a checkpoint spelled as an import or a hand edit might. */
type Checkpoint = "departure" | "after_dive_1" | "after_dive_2" | "after_dive_3" | (string & {});

async function boat(divers: number, plannedDives = 2) {
  const { db, shop } = ctx;
  const made = await returnedTrip(db, shop.id, { endedHoursAgo: 1, divers, plannedDives });
  let minute = 0;
  /** One roll-call event, each a minute after the last so the newest is the one written last. */
  const say = async (
    seat: number,
    checkpoint: Checkpoint,
    status: "boarded" | "not_boarded" | "cleared",
    tripId = made.trip.id,
  ) => {
    minute += 1;
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId,
      bookingId: made.bookingIds[seat] as string,
      recordedByPersonId: made.staffId,
      status,
      checkpoint,
      source: "live",
      occurredAt: new Date(nowMs() - 3 * HOUR + minute * 60_000),
    });
  };
  const mark = (seat: number, status: "no_show" | "cancelled") =>
    db
      .update(bookingsTable)
      .set({ status })
      .where(eq(bookingsTable.id, made.bookingIds[seat] as string));
  /** Every seat reads clear unless named here, so `blocked` is the test's own choice. */
  const readinessFor = (blockedSeats: readonly number[] = []) =>
    new Map(
      made.bookingIds.map((id, seat) => [
        id,
        { status: blockedSeats.includes(seat) ? "blocked" : "ready" } as ReadinessResult,
      ]),
    );
  const count = async (blockedSeats: readonly number[] = []) => {
    const counts = await departureCounts(db, shop.id, [made.trip.id], {
      readiness: readinessFor(blockedSeats),
    });
    const one = counts.get(made.trip.id);
    if (!one) throw new Error("the departure has no count");
    return one;
  };
  return { ...made, say, mark, count };
}

describe("departureCounts", () => {
  /**
   * The issue's own case: one departure with a no-show, a diver who never left
   * the dock, and a missing diver, beside one who is back and one nobody has
   * named at the last count.
   */
  it("counts one departure with a no-show, a not-boarded and a missing diver", async () => {
    const { say, mark, count } = await boat(5);
    // 0: out and back.
    await say(0, "departure", "boarded");
    await say(0, "after_dive_1", "boarded");
    await say(0, "after_dive_2", "boarded");
    // 1: never left the dock.
    await say(1, "departure", "not_boarded");
    // 2: the desk marked a no-show; nobody counted them anywhere.
    await mark(2, "no_show");
    // 3: back after dive 1, recorded not back after dive 2.
    await say(3, "departure", "boarded");
    await say(3, "after_dive_1", "boarded");
    await say(3, "after_dive_2", "not_boarded");
    // 4: back after dive 1, and nobody has named them at dive 2.
    await say(4, "departure", "boarded");
    await say(4, "after_dive_1", "boarded");

    expect(await count([0, 2])).toEqual({
      capacity: 12,
      booked: 4,
      sailed: 3,
      boarded: 3,
      back: 1,
      missing: 1,
      blocked: 2,
    });
  });

  it("calls nobody back before the first after-dive count", async () => {
    const { say, count } = await boat(2);
    await say(0, "departure", "boarded");
    await say(1, "departure", "boarded");
    const counted = await count();
    expect(counted.sailed).toBe(2);
    expect(counted.back).toBe(0);
  });

  it("does not call a diver back on a word the crew retracted", async () => {
    const { say, count } = await boat(2);
    await say(0, "departure", "boarded");
    await say(1, "departure", "boarded");
    await say(0, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "cleared");
    expect((await count()).back).toBe(1);
  });

  it("does not move the count to a checkpoint whose only word was retracted", async () => {
    const { say, count } = await boat(2);
    await say(0, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "boarded");
    // A tap at dive 2 on the wrong boat, taken back.
    await say(0, "after_dive_2", "boarded");
    await say(0, "after_dive_2", "cleared");
    expect((await count()).back).toBe(2);
  });

  it("does not let a retracted after-dive word overrule the desk's no-show", async () => {
    const { say, mark, count } = await boat(1);
    await mark(0, "no_show");
    await say(0, "after_dive_1", "not_boarded");
    await say(0, "after_dive_1", "cleared");
    expect(await count()).toMatchObject({ sailed: 0, back: 0 });
  });

  it("reads the newest word at a checkpoint: counted, then found not to be, is not back", async () => {
    const { say, count } = await boat(1);
    await say(0, "departure", "boarded");
    await say(0, "after_dive_1", "boarded");
    await say(0, "after_dive_1", "not_boarded");
    expect((await count()).back).toBe(0);
  });

  it("does not let an earlier count stand in for the latest one", async () => {
    const { say, count } = await boat(2);
    await say(0, "departure", "boarded");
    await say(1, "departure", "boarded");
    await say(0, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "boarded");
    // The boat is at dive 2 now; only diver 0 has been counted there.
    await say(0, "after_dive_2", "boarded");
    expect((await count()).back).toBe(1);
  });

  it("counts a diver first counted at a later site as sailed and back, not boarded at the dock", async () => {
    const { say, count } = await boat(1);
    await say(0, "after_dive_1", "boarded");
    expect(await count()).toMatchObject({ sailed: 1, boarded: 0, back: 1 });
  });

  it("still finds a chase-boat diver missing, though the dock said they never left", async () => {
    const { say, count } = await boat(2);
    await say(0, "departure", "boarded");
    await say(1, "departure", "not_boarded");
    await say(0, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "boarded");
    expect(await count()).toMatchObject({ sailed: 1, back: 2, missing: 0 });
    await say(0, "after_dive_2", "boarded");
    await say(1, "after_dive_2", "not_boarded");
    expect(await count()).toMatchObject({ sailed: 1, back: 1, missing: 1 });
  });

  it("keeps a missing diver missing until a later count names them aboard", async () => {
    const { say, count } = await boat(2);
    await say(0, "after_dive_1", "not_boarded");
    await say(1, "after_dive_2", "boarded");
    expect((await count()).missing).toBe(1);
    await say(0, "after_dive_2", "boarded");
    expect((await count()).missing).toBe(0);
  });

  it("does not let a stray tap past the planned dives move the count, nor hide a missing diver", async () => {
    const { say, count } = await boat(2, 2);
    await say(0, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "boarded");
    await say(0, "after_dive_3", "boarded");
    expect((await count()).back).toBe(2);
    await say(1, "after_dive_3", "not_boarded");
    expect((await count()).missing).toBe(1);
  });

  it("never credits a word recorded on another departure to this seat", async () => {
    const { db, shop } = ctx;
    const { say, count } = await boat(1);
    const other = await returnedTrip(db, shop.id, {
      endedHoursAgo: 1,
      divers: 1,
      title: "Another boat",
    });
    await say(0, "after_dive_1", "boarded", other.trip.id);
    await say(0, "after_dive_1", "not_boarded", other.trip.id);
    const counts = await departureCounts(db, shop.id, [other.trip.id], { readiness: new Map() });
    expect(await count()).toMatchObject({ back: 0, missing: 0 });
    expect(counts.get(other.trip.id)).toMatchObject({ back: 0, missing: 0 });
  });

  it("reads no checkpoint without a place in the day", async () => {
    const { say, count } = await boat(1);
    await say(0, "after_dive_1.5", "not_boarded");
    await say(0, "after_dive_-1", "boarded");
    expect(await count()).toMatchObject({ back: 0, missing: 0 });
  });

  it("reads two spellings of one checkpoint as one, newest word standing", async () => {
    const { say, count } = await boat(1);
    await say(0, "after_dive_02", "boarded");
    await say(0, "after_dive_2", "not_boarded");
    expect(await count()).toMatchObject({ back: 0, missing: 1 });
  });

  it("reads the roster's own readiness for a seat the caller's map left out", async () => {
    const { db, shop } = ctx;
    const { trip, bookingIds } = await boat(2);
    const rows = await listTripsReadiness(db, shop.id, [trip.id]);
    const truth = rows.filter((row) => row.readiness.status === "blocked").length;
    // Hand in only the first seat, read as clear; the second must come from the pipeline.
    const partial = new Map([[bookingIds[0] as string, { status: "ready" } as ReadinessResult]]);
    const firstBlocked = rows.some(
      (row) => row.booking.id === bookingIds[0] && row.readiness.status === "blocked",
    );
    const counts = await departureCounts(db, shop.id, [trip.id], { readiness: partial });
    expect(counts.get(trip.id)?.blocked).toBe(truth - (firstBlocked ? 1 : 0));
    expect(truth - (firstBlocked ? 1 : 0)).toBeGreaterThan(0);
  });

  it("never counts a diver who never left the dock as sailed or back", async () => {
    const { say, count } = await boat(1);
    await say(0, "departure", "not_boarded");
    expect(await count()).toMatchObject({ booked: 1, sailed: 0, boarded: 0, back: 0 });
  });

  it("lets the crew's dock word overrule the desk's no-show", async () => {
    const { say, mark, count } = await boat(1);
    await mark(0, "no_show");
    await say(0, "departure", "boarded");
    expect(await count()).toMatchObject({ booked: 0, sailed: 1, boarded: 1 });
  });

  it("leaves a cancelled seat out of every number, even with a word on it", async () => {
    const { say, mark, count } = await boat(2);
    await say(0, "departure", "boarded");
    await say(0, "after_dive_1", "boarded");
    await say(1, "departure", "boarded");
    await say(1, "after_dive_1", "boarded");
    await mark(1, "cancelled");
    expect(await count([1])).toEqual({
      capacity: 12,
      booked: 1,
      sailed: 1,
      boarded: 1,
      back: 1,
      missing: 0,
      blocked: 0,
    });
  });

  it("counts blocked seats over the roster the Blocked chip counts: a no-show in, a cancelled seat out", async () => {
    const { mark, count } = await boat(3);
    await mark(1, "no_show");
    await mark(2, "cancelled");
    expect((await count([0, 1, 2])).blocked).toBe(2);
  });

  it("agrees with the manifest's own readers about who boarded and who is missing", async () => {
    const { db, shop } = ctx;
    const { trip, say, count } = await boat(3);
    await say(0, "departure", "boarded");
    await say(1, "departure", "boarded");
    await say(2, "departure", "not_boarded");
    await say(0, "after_dive_1", "boarded");
    await say(1, "after_dive_1", "not_boarded");
    const counted = await count();
    const boardedSeats = (await listDepartureBoardedByTrip(db, shop.id, [trip.id])).get(trip.id);
    const missing = (await listUnaccountedForByTrip(db, shop.id, [trip.id])).get(trip.id);
    expect(counted.boarded).toBe(boardedSeats?.size ?? 0);
    expect(counted.missing).toBe(missing?.size ?? 0);
    expect(counted).toMatchObject({ sailed: 2, back: 1, missing: 1 });
  });

  it("reads readiness through the roster's pipeline when none is handed in", async () => {
    const { db, shop } = ctx;
    const { trip } = await boat(2);
    const rows = await listTripsReadiness(db, shop.id, [trip.id]);
    const counts = await departureCounts(db, shop.id, [trip.id]);
    expect(counts.get(trip.id)?.blocked).toBe(
      rows.filter((row) => row.readiness.status === "blocked").length,
    );
  });

  it("answers every departure asked about, and only this shop's live ones", async () => {
    const { db, shop } = ctx;
    const one = await boat(1);
    const empty = await returnedTrip(db, shop.id, { endedHoursAgo: 1, divers: 1 });
    await db
      .update(bookingsTable)
      .set({ status: "cancelled" })
      .where(eq(bookingsTable.tripId, empty.trip.id));
    const deleted = await returnedTrip(db, shop.id, { endedHoursAgo: 1, divers: 1 });
    await db
      .update(tripsTable)
      .set({ deletedAt: new Date(nowMs()) })
      .where(eq(tripsTable.id, deleted.trip.id));
    const readiness = new Map<string, ReadinessResult | undefined>();
    const counts = await departureCounts(
      db,
      shop.id,
      [one.trip.id, empty.trip.id, deleted.trip.id, one.trip.id],
      { readiness },
    );
    expect([...counts.keys()].sort()).toEqual([one.trip.id, empty.trip.id].sort());
    expect(counts.get(empty.trip.id)).toEqual({
      capacity: 12,
      booked: 0,
      sailed: 0,
      boarded: 0,
      back: 0,
      missing: 0,
      blocked: 0,
    });
    // Another shop's id reads nothing.
    expect((await departureCounts(db, one.staffId, [one.trip.id], { readiness })).size).toBe(0);
    expect((await departureCounts(db, shop.id, [], { readiness })).size).toBe(0);
  });
});
