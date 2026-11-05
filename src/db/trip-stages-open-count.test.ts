import { and, desc, eq, lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { boardAtDeparture, HOUR, returnedTrip } from "./roll-call-test-fixtures";
import { rollCallEvents, tripAssignments, trips } from "./schema";
import { resetDemoSchedule } from "./seed";
import { latestTripStage, readDepartureStage, recordTripStage } from "./trip-stages";
import { liveTrip } from "./trips-live";

const ctx = fileScopedShopContext();

/**
 * **A boat stays live until its after-dive roll call is resolved** (loop 5,
 * row 4; issue #2404). The clock alone never finishes a departure while a
 * diver who went out has no word at the last count: a night boat out past
 * midnight with somebody unmarked must not read as finished. The crew's own
 * Home still does, as it did.
 */
async function boat() {
  const { db, shop } = ctx;
  const made = await returnedTrip(db, shop.id, { endedHoursAgo: 6, divers: 2, plannedDives: 2 });
  await boardAtDeparture(db, {
    shopId: shop.id,
    tripId: made.trip.id,
    staffId: made.staffId,
    bookingIds: made.bookingIds,
  });
  let minute = 0;
  const say = async (bookingId: string, checkpoint: string, status: "boarded" | "not_boarded") => {
    minute += 1;
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: made.trip.id,
      bookingId,
      recordedByPersonId: made.staffId,
      status,
      checkpoint,
      source: "live",
      occurredAt: new Date(nowMs() - 5 * HOUR + minute * 60_000),
    });
  };
  const reading = async () =>
    readDepartureStage(db, shop.id, made.trip.id, {
      startsAt: made.trip.startsAt,
      endsAt: made.trip.endsAt,
      now: nowDate(),
      timeZone: shop.timezone,
      stage: await latestTripStage(db, shop.id, made.trip.id),
      cancelled: false,
    });
  return { ...made, say, reading };
}

describe("readDepartureStage: an after-dive count still open", () => {
  it("keeps a departure live when a diver who went out has no mark at the last count", async () => {
    const { bookingIds, say, reading } = await boat();
    const [first, second] = bookingIds as [string, string];
    await say(first, "after_dive_1", "boarded");
    await say(second, "after_dive_1", "boarded");
    await say(first, "after_dive_2", "boarded");
    // The second diver has no word at all after dive 2: not "missing", unmarked.
    expect((await reading()).finished).toBe(false);
  });

  it("finishes a boat whose shop counts only at the dock: no after-dive count was started", async () => {
    const { reading } = await boat();
    expect((await reading()).finished).toBe(true);
  });

  it("keeps it live when a diver was recorded not back aboard", async () => {
    const { bookingIds, say, reading } = await boat();
    const [first, second] = bookingIds as [string, string];
    await say(first, "after_dive_1", "boarded");
    await say(second, "after_dive_1", "not_boarded");
    expect((await reading()).finished).toBe(false);
  });

  it("finishes once everyone who went out is counted back at every dive", async () => {
    const { bookingIds, say, reading } = await boat();
    for (const checkpoint of ["after_dive_1", "after_dive_2"]) {
      for (const id of bookingIds) await say(id, checkpoint, "boarded");
    }
    expect((await reading()).finished).toBe(true);
  });

  it("still lets the crew's own Home finish it, the departure's last word", async () => {
    const { db, shop } = ctx;
    const { trip, staffId, reading } = await boat();
    await recordTripStage(db, {
      shopId: shop.id,
      tripId: trip.id,
      stage: "home",
      recordedByPersonId: staffId,
    });
    expect((await reading()).finished).toBe(true);
  });
});

/**
 * **The record names a seat no started after-dive count included** (issue
 * #3895). Once Home finishes the departure, a diver boarded at the dock with
 * no mark at a started after-dive checkpoint is not filed under Sailed as if
 * counted: the record says "Not counted after dive N". A seat recorded not
 * back aboard stays in its own group.
 */
describe("readDepartureStage: who the record says was not counted after a dive", () => {
  async function home(made: Awaited<ReturnType<typeof boat>>) {
    const { db, shop } = ctx;
    await recordTripStage(db, {
      shopId: shop.id,
      tripId: made.trip.id,
      stage: "home",
      recordedByPersonId: made.staffId,
    });
    return made.reading();
  }

  it("names a diver left out of the started count after dive 2", async () => {
    const made = await boat();
    const [first, second] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    await made.say(second, "after_dive_1", "boarded");
    await made.say(first, "after_dive_2", "boarded");
    const reading = await home(made);
    expect(reading.finished).toBe(true);
    expect([...reading.notCountedAfterDive]).toEqual([[second, 2]]);
  });

  it("names the first dive a diver was left out of", async () => {
    const made = await boat();
    const [first, second] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    await made.say(first, "after_dive_2", "boarded");
    expect([...(await home(made)).notCountedAfterDive]).toEqual([[second, 1]]);
  });

  it("does not name a diver counted back aboard after a later dive", async () => {
    const made = await boat();
    const [first, second] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    await made.say(first, "after_dive_2", "boarded");
    await made.say(second, "after_dive_2", "boarded");
    expect((await home(made)).notCountedAfterDive.size).toBe(0);
  });

  it("keeps a diver recorded not back aboard in the missing group, not this one", async () => {
    const made = await boat();
    const [first, second] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    await made.say(second, "after_dive_1", "not_boarded");
    const reading = await home(made);
    expect(reading.unaccounted.has(second)).toBe(true);
    expect(reading.notCountedAfterDive.has(second)).toBe(false);
  });

  it("names nobody where no after-dive count was started", async () => {
    const made = await boat();
    expect((await home(made)).notCountedAfterDive.size).toBe(0);
  });

  it("names nobody while the departure is still live", async () => {
    const made = await boat();
    const [first] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    const reading = await made.reading();
    expect(reading.finished).toBe(false);
    expect(reading.notCountedAfterDive.size).toBe(0);
  });
});

/**
 * **Home keeps how many the last count left out** (issue #3896). Home is never
 * refused; the event records the count so the record says "Home with 2 not
 * counted".
 */
describe("recordTripStage: Home with the after-dive count open", () => {
  async function sayHome(
    made: Awaited<ReturnType<typeof boat>>,
    stage: "home" | "heading_in" = "home",
  ) {
    const { db, shop } = ctx;
    const outcome = await recordTripStage(db, {
      shopId: shop.id,
      tripId: made.trip.id,
      stage,
      recordedByPersonId: made.staffId,
    });
    return { outcome, latest: await latestTripStage(db, shop.id, made.trip.id) };
  }

  it("records Home with the people the last count has not accounted for", async () => {
    const made = await boat();
    const [first, second] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    await made.say(second, "after_dive_1", "boarded");
    await made.say(first, "after_dive_2", "boarded");
    const { outcome, latest } = await sayHome(made);
    expect(outcome).toMatchObject({ ok: true });
    expect(latest).toMatchObject({ stage: "home", notCounted: 1 });
  });

  it("counts a person recorded not back aboard with the unmarked", async () => {
    const made = await boat();
    const [first, second] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_1", "boarded");
    await made.say(second, "after_dive_1", "boarded");
    await made.say(first, "after_dive_2", "not_boarded");
    expect((await sayHome(made)).latest).toMatchObject({ notCounted: 2 });
  });

  it("records no count when everyone is counted back", async () => {
    const made = await boat();
    for (const checkpoint of ["after_dive_1", "after_dive_2"]) {
      for (const id of made.bookingIds) await made.say(id, checkpoint, "boarded");
    }
    expect((await sayHome(made)).latest).toMatchObject({ stage: "home", notCounted: null });
  });

  it("records no count on Heading in, which still warns", async () => {
    const made = await boat();
    const [first] = made.bookingIds as [string, string];
    await made.say(first, "after_dive_2", "boarded");
    const { outcome, latest } = await sayHome(made, "heading_in");
    expect(latest).toMatchObject({ stage: "heading_in", notCounted: null });
    expect(outcome.ok && outcome.rollCallOpen).toBeTruthy();
  });
});

describe("readDepartureStage: a departure cancelled after boarding", () => {
  it("never reads finished by the clock, whatever the roll call says (attacker S5)", async () => {
    const { db, shop } = ctx;
    const { trip } = await boat();
    // Boarded at the dock, nobody counted after a dive, then called off.
    const reading = await readDepartureStage(db, shop.id, trip.id, {
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      now: nowDate(),
      timeZone: shop.timezone,
      stage: await latestTripStage(db, shop.id, trip.id),
      cancelled: true,
    });
    expect(reading.finished).toBe(false);
  });
});

describe("readDepartureStage: crew counted back at a later dive", () => {
  it("finishes when a divemaster missing after dive 1 is counted aboard after dive 2 (dock S2)", async () => {
    const { db, shop } = ctx;
    const { trip, staffId, bookingIds, say, reading } = await boat();
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: staffId });
    let minute = 30;
    const crew = async (checkpoint: string, status: "boarded" | "not_boarded") => {
      minute += 1;
      await db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        subjectKind: "crew",
        crewPersonId: staffId,
        recordedByPersonId: staffId,
        status,
        checkpoint,
        source: "live",
        occurredAt: new Date(nowMs() - 5 * HOUR + minute * 60_000),
      });
    };
    await crew("departure", "boarded");
    await crew("after_dive_1", "not_boarded");
    await crew("after_dive_2", "boarded");
    for (const checkpoint of ["after_dive_1", "after_dive_2"]) {
      for (const id of bookingIds) await say(id, checkpoint, "boarded");
    }
    expect((await reading()).finished).toBe(true);
  });
});

describe("readDepartureStage over the demo's sailed history", () => {
  it("reads every recent history departure as finished: its counts were all closed", async () => {
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id, "history");
    const sailed = await db
      .select()
      .from(trips)
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shop.id),
          eq(trips.status, "scheduled"),
          lt(trips.endsAt, new Date(nowMs() - 2 * HOUR)),
        ),
      )
      .orderBy(desc(trips.endsAt))
      .limit(8);
    expect(sailed.length).toBeGreaterThan(0);
    const open: string[] = [];
    for (const trip of sailed) {
      const reading = await readDepartureStage(db, shop.id, trip.id, {
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        now: nowDate(),
        timeZone: shop.timezone,
        stage: await latestTripStage(db, shop.id, trip.id),
        cancelled: false,
      });
      if (!reading.finished) open.push(trip.title);
    }
    expect(open).toEqual([]);
  });
});
