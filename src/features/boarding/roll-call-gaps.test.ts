import { describe, expect, it } from "vitest";
import { recordDiveNotMade, undoDiveNotMade } from "@/db/dive-not-made";
import { upsertExecutedDive } from "@/db/executed-dives";
import { crewSubject } from "@/db/roll-call-subject";
import { tripAssignments } from "@/db/schema";
import { seedRollCallEvidence } from "@/db/seed/roll-call-evidence";
import { advanceClock } from "@/test/clock";
import { nowDate, nowMs } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import {
  boardAtDeparture,
  HOUR,
  returnedTrip,
} from "../../test/substrate-fixtures/db/roll-call-test-fixtures";
import {
  listRollCallGaps,
  openAfterDiveRollCalls,
  RETURNED_ROLL_CALL_LOOKBACK_MS,
  ROLL_CALL_RESIDUE_MS,
  tripsWithSomebodyMissing,
} from "./roll-call-gaps";

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
    await seedRollCallEvidence(db, {
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

/**
 * **A dive the crew recorded not made** (issue #4809) closes that dive's
 * after-dive count on Today, the way it closes the dive's item on Wrapped up
 * (#4681). Only that dive's count, only while nobody has counted or logged
 * the dive since, and never a person: a missing diver, an earlier dive's
 * open count, or another day's dive stays raised.
 */
describe("a dive recorded not made", () => {
  async function notMadeBoat() {
    const made = await boat({ endedHoursAgo: 3 });
    await ctx.db.insert(tripAssignments).values({ tripId: made.trip.id, personId: made.staffId });
    const word = { shopId: ctx.shop.id, tripId: made.trip.id, personId: made.staffId };
    const notMade = async (diveNumber: number) => {
      advanceClock(1000);
      const outcome = await recordDiveNotMade(ctx.db, { ...word, diveNumber });
      if (!outcome.ok) throw new Error(`test record refused: ${outcome.reason}`);
    };
    const undo = async (diveNumber: number) => {
      advanceClock(1000);
      const outcome = await undoDiveNotMade(ctx.db, { ...word, diveNumber });
      if (!outcome.ok) throw new Error(`test undo refused: ${outcome.reason}`);
    };
    return { ...made, notMade, undo };
  }

  it("closes that dive's after-dive count once everyone is counted back after the dives made", async () => {
    const { bookingIds, say, notMade, gaps } = await notMadeBoat();
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    expect(await gaps()).toMatchObject([{ reason: "after_dive_uncounted", diveNumber: 2 }]);

    await notMade(2);

    expect(await gaps()).toEqual([]);
  });

  it("keeps an earlier dive's open count raised", async () => {
    const { bookingIds, say, notMade, gaps } = await notMadeBoat();
    await say(bookingIds[0] as string, "after_dive_1", "boarded");
    await notMade(2);

    expect(await gaps()).toMatchObject([
      { reason: "after_dive_uncounted", diveNumber: 1, uncounted: 2 },
    ]);
  });

  it("moves to the next dive nobody counted when the first was not made", async () => {
    const { notMade, gaps } = await notMadeBoat();
    await notMade(1);

    expect(await gaps()).toMatchObject([
      { reason: "after_dive_uncounted", diveNumber: 2, uncounted: 3 },
    ]);
  });

  it("never hides a diver recorded not back aboard", async () => {
    const { bookingIds, say, notMade, gaps } = await notMadeBoat();
    await say(bookingIds[0] as string, "after_dive_1", "not_boarded");
    await say(bookingIds[1] as string, "after_dive_1", "boarded");
    await say(bookingIds[2] as string, "after_dive_1", "boarded");
    await notMade(2);

    expect(await gaps()).toMatchObject([{ reason: "missing_diver", diveNumber: 1, uncounted: 1 }]);
  });

  it("raises the count again once the record is undone", async () => {
    const { bookingIds, say, notMade, undo, gaps } = await notMadeBoat();
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    await notMade(2);
    await undo(2);

    expect(await gaps()).toMatchObject([{ reason: "after_dive_uncounted", diveNumber: 2 }]);
  });

  it("gives way to a count of the dive begun after the record", async () => {
    const { bookingIds, say, notMade, gaps } = await notMadeBoat();
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    await notMade(2);
    await say(bookingIds[0] as string, "after_dive_2", "boarded");

    expect(await gaps()).toMatchObject([
      { reason: "after_dive_uncounted", diveNumber: 2, uncounted: 2 },
    ]);
  });

  it("gives way to a log of the dive written after the record", async () => {
    const { bookingIds, say, notMade, gaps, trip, staffId } = await notMadeBoat();
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    await notMade(2);
    const logged = await upsertExecutedDive(ctx.db, {
      shopId: ctx.shop.id,
      tripId: trip.id,
      diveNumber: 2,
      enteredAt: new Date(trip.endsAt.getTime() - HOUR),
      exitedAt: new Date(trip.endsAt.getTime() - HOUR / 2),
      maxDepthMeters: null,
      recordedByPersonId: staffId,
    });
    if (!logged.ok) throw new Error(`test log refused: ${logged.reason}`);

    expect(await gaps()).toMatchObject([{ reason: "after_dive_uncounted", diveNumber: 2 }]);
  });

  it("closes the crew's count of that dive too, and never a crew member recorded not back", async () => {
    const { db, shop } = ctx;
    const { bookingIds, say, notMade, gaps, trip, staffId } = await notMadeBoat();
    for (const id of bookingIds) await say(id, "after_dive_1", "boarded");
    const crewMark = (checkpoint: string, status: "boarded" | "not_boarded", minute: number) =>
      seedRollCallEvidence(db, {
        shopId: shop.id,
        tripId: trip.id,
        ...crewSubject(staffId),
        recordedByPersonId: staffId,
        status,
        checkpoint,
        source: "live",
        occurredAt: new Date(trip.startsAt.getTime() + minute * 60_000),
      });
    await crewMark("departure", "boarded", 2);
    await crewMark("after_dive_1", "boarded", 90);
    expect((await gaps()).map((gap) => [gap.reason, gap.diveNumber])).toEqual([
      ["after_dive_uncounted", 2],
      ["crew_uncounted", 2],
    ]);
    await notMade(2);
    expect(await gaps()).toEqual([]);

    await crewMark("after_dive_1", "not_boarded", 95);
    expect(await gaps()).toMatchObject([{ reason: "missing_crew", diveNumber: 1 }]);
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
