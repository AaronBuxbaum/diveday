import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  listRollCallGaps,
  openAfterDiveRollCalls,
  RETURNED_ROLL_CALL_LOOKBACK_MS,
  ROLL_CALL_RESIDUE_MS,
  tripsWithSomebodyMissing,
} from "./roll-call-gaps";
import { boardAtDeparture, HOUR, returnedTrip } from "./roll-call-test-fixtures";
import { rollCallEvents } from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **The one detector of open head counts** (DOM-H3), read directly. Today, the
 * close-out, the board, the stale-count alert and the recap all ask this
 * reader, so its own suite sits beside it: the cases that must raise a row
 * (a diver recorded not back aboard, a count never finished, a boat with no
 * roll call), the ones that must not (everyone counted back), and the two
 * windows a gap ages through (48 hours of dock work, then 30 days of residue).
 */

async function boat(options: { endedHoursAgo: number; divers?: number; board?: boolean }) {
  const { db, shop } = ctx;
  const made = await returnedTrip(db, shop.id, {
    endedHoursAgo: options.endedHoursAgo,
    divers: options.divers ?? 3,
    plannedDives: 2,
  });
  if (options.board !== false) {
    await boardAtDeparture(
      db,
      { shopId: shop.id, tripId: made.trip.id, staffId: made.staffId, bookingIds: made.bookingIds },
      new Date(made.trip.startsAt.getTime() + 60_000),
    );
  }
  let minute = 0;
  const say = async (
    bookingId: string,
    checkpoint: "departure" | "after_dive_1" | "after_dive_2",
    status: "boarded" | "not_boarded",
  ) => {
    minute += 1;
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: made.trip.id,
      bookingId,
      recordedByPersonId: made.staffId,
      status,
      checkpoint,
      source: "live",
      occurredAt: new Date(made.trip.startsAt.getTime() + HOUR + minute * 60_000),
    });
  };
  const gaps = async () =>
    (await listRollCallGaps(db, shop.id, nowDate())).filter((gap) => gap.tripId === made.trip.id);
  return { ...made, say, gaps };
}

describe("listRollCallGaps", () => {
  it("raises a missing diver when somebody is recorded not back aboard after a dive", async () => {
    const { bookingIds, say, gaps } = await boat({ endedHoursAgo: 3 });
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    await say(bookingIds[0] as string, "after_dive_2", "not_boarded");
    await say(bookingIds[1] as string, "after_dive_2", "boarded");

    const found = await gaps();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      reason: "missing_diver",
      diveNumber: 2,
      uncounted: 1,
      awaiting: 1,
      total: 3,
      stale: false,
      underway: false,
    });
  });

  it("raises an unfinished after-dive count when a diver who boarded has no result", async () => {
    const { bookingIds, say, gaps } = await boat({ endedHoursAgo: 3 });
    await say(bookingIds[0] as string, "after_dive_1", "boarded");
    await say(bookingIds[1] as string, "after_dive_1", "boarded");

    const [gap] = await gaps();
    expect(gap).toMatchObject({ reason: "after_dive_uncounted", diveNumber: 1, uncounted: 1 });
  });

  it("raises nothing once everyone is counted back after every dive", async () => {
    const { bookingIds, say, gaps } = await boat({ endedHoursAgo: 3 });
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    for (const id of bookingIds) await say(id, "after_dive_2", "boarded");

    expect(await gaps()).toEqual([]);
  });

  it("states a boat home with no roll call at all, quietly, as the dock's paperwork", async () => {
    const { gaps } = await boat({ endedHoursAgo: 3, board: false });

    const [gap] = await gaps();
    expect(gap).toMatchObject({ reason: "no_roll_call", diveNumber: 0, uncounted: 3 });
  });

  it("keeps a missing diver as residue after the dock-work window, and drops nothing", async () => {
    const hoursAgo = RETURNED_ROLL_CALL_LOOKBACK_MS / HOUR + 6;
    const { bookingIds, say, gaps } = await boat({ endedHoursAgo: hoursAgo });
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");

    const [gap] = await gaps();
    expect(gap).toMatchObject({ reason: "missing_diver", stale: true });
  });

  it("lets a boat older than the residue window go", async () => {
    const hoursAgo = ROLL_CALL_RESIDUE_MS / HOUR + 6;
    const { bookingIds, say, gaps } = await boat({ endedHoursAgo: hoursAgo });
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");

    expect(await gaps()).toEqual([]);
  });

  it("answers no trips with no gaps, without reading", async () => {
    const { db, shop } = ctx;
    expect(await listRollCallGaps(db, shop.id, nowDate(), [])).toEqual([]);
  });
});

describe("tripsWithSomebodyMissing", () => {
  it("names only the departures with a missing person, out of those asked about", async () => {
    const { db, shop } = ctx;
    const missing = await boat({ endedHoursAgo: 3 });
    await missing.say(missing.bookingIds[0] as string, "after_dive_1", "not_boarded");
    const unfinished = await boat({ endedHoursAgo: 3 });
    await unfinished.say(unfinished.bookingIds[0] as string, "after_dive_1", "boarded");

    const named = await tripsWithSomebodyMissing(
      db,
      shop.id,
      [missing.trip.id, unfinished.trip.id],
      new Date(nowMs()),
    );
    expect([...named]).toEqual([missing.trip.id]);
  });
});

describe("openAfterDiveRollCalls", () => {
  it("keeps the after-dive gaps the board can point at, and leaves the dock's to Today", async () => {
    const { db, shop } = ctx;
    const afterDive = await boat({ endedHoursAgo: 3 });
    await afterDive.say(afterDive.bookingIds[0] as string, "after_dive_1", "boarded");
    const dock = await boat({ endedHoursAgo: 3, board: false });

    const open = await openAfterDiveRollCalls(db, shop.id, nowDate());
    const ids = open.map((gap) => gap.tripId);
    expect(ids).toContain(afterDive.trip.id);
    expect(ids).not.toContain(dock.trip.id);
  });
});
