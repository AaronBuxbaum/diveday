import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { listRollCallGaps, oneRowPerHalf } from "./roll-call-gaps";
import { crewSubject } from "./roll-call-subject";
import {
  bookings,
  people,
  rollCallEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { listStaff } from "./trips";
import { livePerson } from "./trips-live";

/**
 * **A course on two Saturdays opens no roll call between them, and day one's
 * count never closes day two's** (#2557). Checkpoints are keyed per booking,
 * not per day, so every result belongs to the meeting day it was taken on.
 * Adversarial: each case below is a way the one-window reading either kept a
 * boat "on the water" for a fortnight or let Saturday's count answer for the
 * Saturday two weeks on.
 */

const ctx = fileScopedShopContext();

// Saturday 2026-08-01 and Saturday 2026-08-15, 09:00 to 13:00 EDT, two dives.
const SAT_ONE = { start: "2026-08-01T13:00:00.000Z", end: "2026-08-01T17:00:00.000Z" };
const SAT_TWO = { start: "2026-08-15T13:00:00.000Z", end: "2026-08-15T17:00:00.000Z" };
const at = (iso: string) => new Date(iso);

async function course(divers = 2) {
  const { db, shop } = ctx;
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Open Water, two Saturdays",
      startsAt: at(SAT_ONE.start),
      endsAt: at(SAT_TWO.end),
      capacity: 6,
      plannedDives: 2,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db.insert(tripScheduleDays).values([
    { tripId: trip.id, dayNumber: 1, startsAt: at(SAT_ONE.start), endsAt: at(SAT_ONE.end) },
    { tripId: trip.id, dayNumber: 2, startsAt: at(SAT_TWO.start), endsAt: at(SAT_TWO.end) },
  ]);
  const found = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), livePerson()))
    .limit(divers);
  const rows = await db
    .insert(bookings)
    .values(
      found.map((person) => ({
        bookedAs: "diver" as const,
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        status: "booked" as const,
      })),
    )
    .returning();
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seed staff missing");
  /** Writes one mark and answers its id; an undo names the mark it takes back (#3995). */
  const say = async (
    bookingId: string,
    checkpoint: "departure" | "after_dive_1" | "after_dive_2",
    status: "boarded" | "not_boarded" | "cleared",
    occurredAt: string,
    retractsEventId?: string,
  ) => {
    const [row] = await db
      .insert(rollCallEvents)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staff.person.id,
        status,
        checkpoint,
        source: "live",
        occurredAt: at(occurredAt),
        retractsEventId,
      })
      .returning({ id: rollCallEvents.id });
    if (!row) throw new Error("roll call insert failed");
    return row.id;
  };
  /** A whole day counted: boarded at the dock and back aboard after both dives. */
  const countDay = async (day: typeof SAT_ONE, ids = rows.map((row) => row.id)) => {
    const base = at(day.start).getTime();
    for (const id of ids) {
      await say(id, "departure", "boarded", new Date(base - 15 * 60_000).toISOString());
      await say(id, "after_dive_1", "boarded", new Date(base + 90 * 60_000).toISOString());
      await say(id, "after_dive_2", "boarded", new Date(base + 200 * 60_000).toISOString());
    }
  };
  const gaps = async (now: string) =>
    (await listRollCallGaps(db, shop.id, at(now))).filter((gap) => gap.tripId === trip.id);
  return { trip, bookingIds: rows.map((row) => row.id), say, countDay, gaps };
}

describe("roll call on a course that meets on two Saturdays", () => {
  it("opens no gap on any day between once Saturday's count is closed", async () => {
    const c = await course();
    await c.countDay(SAT_ONE);
    for (const now of [
      "2026-08-01T19:00:00.000Z",
      "2026-08-02T14:00:00.000Z",
      "2026-08-08T14:00:00.000Z",
      "2026-08-14T23:00:00.000Z",
      "2026-08-15T12:00:00.000Z",
    ]) {
      expect(await c.gaps(now), now).toEqual([]);
    }
  });

  it("raises Saturday's unfinished count as a boat that is home, not one out for a fortnight", async () => {
    const c = await course();
    const [first, second] = c.bookingIds as [string, string];
    await c.say(first, "departure", "boarded", "2026-08-01T12:45:00.000Z");
    await c.say(second, "departure", "boarded", "2026-08-01T12:46:00.000Z");
    await c.say(first, "after_dive_1", "boarded", "2026-08-01T14:30:00.000Z");
    // The one-window reading called this underway until Aug 15 and stayed quiet
    // about a count nobody started; Saturday's own window says it is home.
    const [gap] = await c.gaps("2026-08-02T14:00:00.000Z");
    expect(gap).toMatchObject({
      reason: "after_dive_uncounted",
      diveNumber: 1,
      uncounted: 1,
      underway: false,
      dayNumber: 1,
      endsAt: at(SAT_ONE.end),
    });
  });

  it("is underway only inside the second Saturday, and quiet there until a count is abandoned", async () => {
    const c = await course();
    await c.countDay(SAT_ONE);
    const [first] = c.bookingIds as [string, string];
    await c.say(first, "departure", "boarded", "2026-08-15T12:45:00.000Z");
    expect(await c.gaps("2026-08-15T14:00:00.000Z")).toEqual([]);
  });

  it("does not let Saturday's 'back aboard' close the second Saturday's dive", async () => {
    const c = await course();
    await c.countDay(SAT_ONE);
    // Second Saturday: both board, nobody is counted back after either dive.
    for (const id of c.bookingIds)
      await c.say(id, "departure", "boarded", "2026-08-15T12:45:00.000Z");
    const found = await c.gaps("2026-08-15T19:00:00.000Z");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      reason: "after_dive_uncounted",
      diveNumber: 1,
      uncounted: 2,
      total: 2,
      underway: false,
      dayNumber: 2,
      startsAt: at(SAT_TWO.start),
    });
  });

  it("asks for the second Saturday's dock count when nobody counted that day at all", async () => {
    const c = await course();
    await c.countDay(SAT_ONE);
    const found = await c.gaps("2026-08-15T19:00:00.000Z");
    expect(found).toMatchObject([{ reason: "no_roll_call", dayNumber: 2, uncounted: 2 }]);
  });

  it("keeps Saturday's missing diver on the second Saturday until that diver is counted again", async () => {
    const c = await course();
    const [first, second] = c.bookingIds as [string, string];
    for (const id of c.bookingIds)
      await c.say(id, "departure", "boarded", "2026-08-01T12:45:00.000Z");
    await c.say(first, "after_dive_1", "not_boarded", "2026-08-01T14:30:00.000Z");
    await c.say(second, "after_dive_1", "boarded", "2026-08-01T14:31:00.000Z");
    await c.say(second, "after_dive_2", "boarded", "2026-08-01T16:30:00.000Z");
    // Only the other diver turns up a fortnight later and is counted all day.
    await c.countDay(SAT_TWO, [second]);
    const missing = (await c.gaps("2026-08-15T19:00:00.000Z")).find(
      (gap) => gap.reason === "missing_diver",
    );
    expect(missing).toMatchObject({ dayNumber: 1, uncounted: 1 });
    // The missing diver boards on the second Saturday: they stood on the dock.
    await c.say(first, "departure", "boarded", "2026-08-15T12:50:00.000Z");
    await c.say(first, "after_dive_1", "boarded", "2026-08-15T14:30:00.000Z");
    await c.say(first, "after_dive_2", "boarded", "2026-08-15T16:30:00.000Z");
    expect(await c.gaps("2026-08-15T19:00:00.000Z")).toEqual([]);
  });

  it("keeps Saturday's diver missing after dive 2 through a second-Saturday tap after dive 1, until the dock count (#4056)", async () => {
    const c = await course();
    const [first] = c.bookingIds as [string, string];
    await c.countDay(SAT_ONE);
    await c.say(first, "after_dive_2", "not_boarded", "2026-08-01T16:40:00.000Z");
    await c.say(first, "after_dive_1", "boarded", "2026-08-15T14:30:00.000Z");
    expect(
      (await c.gaps("2026-08-15T14:40:00.000Z")).filter((gap) => gap.reason === "missing_diver"),
    ).toMatchObject([{ dayNumber: 1, diveNumber: 2, uncounted: 1 }]);
    await c.say(first, "departure", "boarded", "2026-08-15T14:45:00.000Z");
    expect(
      (await c.gaps("2026-08-15T14:50:00.000Z")).filter((gap) => gap.reason === "missing_diver"),
    ).toEqual([]);
  });

  it("reads a crew member missing after Saturday's dive 2 the same way (#4056)", async () => {
    const c = await course();
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    await db.insert(tripAssignments).values({ tripId: c.trip.id, personId: staff.person.id });
    const crew = async (checkpoint: string, status: "boarded" | "not_boarded", iso: string) =>
      db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId: c.trip.id,
        ...crewSubject(staff.person.id),
        recordedByPersonId: staff.person.id,
        status,
        checkpoint,
        source: "live",
        occurredAt: at(iso),
      });
    await c.countDay(SAT_ONE);
    await crew("departure", "boarded", "2026-08-01T12:40:00.000Z");
    await crew("after_dive_1", "boarded", "2026-08-01T14:30:00.000Z");
    await crew("after_dive_2", "not_boarded", "2026-08-01T16:40:00.000Z");
    await crew("after_dive_1", "boarded", "2026-08-15T14:30:00.000Z");
    const missingCrew = async (now: string) =>
      (await c.gaps(now)).filter((gap) => gap.reason === "missing_crew");
    expect(await missingCrew("2026-08-15T14:40:00.000Z")).toMatchObject([
      { dayNumber: 1, diveNumber: 2 },
    ]);
    await crew("after_dive_2", "boarded", "2026-08-15T16:30:00.000Z");
    expect(await missingCrew("2026-08-15T16:40:00.000Z")).toEqual([]);
  });

  it("keeps a second-Saturday dock tap from settling Saturday's own open count before it happens", async () => {
    const c = await course();
    const [first] = c.bookingIds as [string, string];
    for (const id of c.bookingIds)
      await c.say(id, "departure", "boarded", "2026-08-01T12:45:00.000Z");
    await c.say(first, "after_dive_1", "not_boarded", "2026-08-01T14:30:00.000Z");
    // Wednesday: nothing taken on the second day yet, the missing row stands.
    expect(await c.gaps("2026-08-05T14:00:00.000Z")).toMatchObject([
      { reason: "missing_diver", dayNumber: 1, underway: false },
    ]);
  });

  it("keeps Saturday's missing diver and the second Saturday's open count both on the list", async () => {
    const c = await course();
    const [first, second] = c.bookingIds as [string, string];
    for (const id of c.bookingIds)
      await c.say(id, "departure", "boarded", "2026-08-01T12:45:00.000Z");
    await c.say(first, "after_dive_1", "not_boarded", "2026-08-01T14:30:00.000Z");
    await c.say(second, "after_dive_1", "boarded", "2026-08-01T14:31:00.000Z");
    await c.say(second, "after_dive_2", "boarded", "2026-08-01T16:30:00.000Z");
    // Second Saturday: the other diver boards and nobody counts them back.
    await c.say(second, "departure", "boarded", "2026-08-15T12:45:00.000Z");
    const found = await c.gaps("2026-08-15T19:00:00.000Z");
    expect(found.map((gap) => [gap.reason, gap.dayNumber, gap.uncounted])).toEqual([
      ["after_dive_uncounted", 2, 1],
      // The missing diver was not on the second Saturday's dock either.
      ["departure_uncounted", 2, 1],
      ["missing_diver", 1, 1],
    ]);
  });

  it("keeps Saturday's own gap when the second Saturday has a gap of its own", async () => {
    const c = await course();
    const [first, second] = c.bookingIds as [string, string];
    for (const id of c.bookingIds)
      await c.say(id, "departure", "boarded", "2026-08-01T12:45:00.000Z");
    await c.say(first, "after_dive_1", "not_boarded", "2026-08-01T14:30:00.000Z");
    await c.say(second, "after_dive_1", "boarded", "2026-08-01T14:31:00.000Z");
    await c.say(second, "after_dive_2", "boarded", "2026-08-01T16:30:00.000Z");
    // Second Saturday: the other diver is missing after dive 1 as well.
    await c.say(second, "departure", "boarded", "2026-08-15T12:45:00.000Z");
    await c.say(second, "after_dive_1", "not_boarded", "2026-08-15T14:30:00.000Z");
    const found = await c.gaps("2026-08-15T19:00:00.000Z");
    expect(found.filter((gap) => gap.reason === "missing_diver")).toEqual([
      expect.objectContaining({ dayNumber: 2, uncounted: 1 }),
      expect.objectContaining({ dayNumber: 1, uncounted: 1 }),
    ]);
  });

  it("raises a diver marked not back before the second Saturday's stored start", async () => {
    const c = await course();
    await c.countDay(SAT_ONE);
    const [first, second] = c.bookingIds as [string, string];
    // The boat left early: taps at 08:00 EDT, before the 09:00 stored start.
    await c.say(first, "departure", "boarded", "2026-08-15T11:30:00.000Z");
    await c.say(second, "departure", "boarded", "2026-08-15T11:31:00.000Z");
    await c.say(first, "after_dive_1", "not_boarded", "2026-08-15T12:30:00.000Z");
    expect(await c.gaps("2026-08-15T12:40:00.000Z")).toMatchObject([
      { reason: "missing_diver", dayNumber: 2, uncounted: 1 },
    ]);
  });

  it("lets the second Saturday take back Saturday's mis-tapped 'not back aboard'", async () => {
    const c = await course();
    const [first] = c.bookingIds as [string, string];
    await c.countDay(SAT_ONE);
    const missing = await c.say(first, "after_dive_2", "not_boarded", "2026-08-01T16:40:00.000Z");
    expect(await c.gaps("2026-08-10T14:00:00.000Z")).toMatchObject([
      { reason: "missing_diver", dayNumber: 1 },
    ]);
    // An undo that names no mark leaves Saturday's missing diver raised.
    await c.say(first, "after_dive_2", "cleared", "2026-08-10T14:04:00.000Z");
    expect(await c.gaps("2026-08-10T14:04:30.000Z")).toMatchObject([
      { reason: "missing_diver", dayNumber: 1 },
    ]);
    await c.say(first, "after_dive_2", "cleared", "2026-08-10T14:05:00.000Z", missing);
    // Taken back, the diver reads as not yet counted there, never as missing.
    expect(await c.gaps("2026-08-10T14:10:00.000Z")).toMatchObject([
      { reason: "after_dive_uncounted", dayNumber: 1, diveNumber: 2, uncounted: 1 },
    ]);
  });

  describe("an undo is not a count: it never says where a later day's roll call began (#4018)", () => {
    /** Saturday counted, one diver mis-tapped not back after dive 2, undone by name at 07:30 on the second Saturday. */
    async function undoneEarlyOnDayTwo() {
      const c = await course();
      const [first] = c.bookingIds as [string, string];
      await c.countDay(SAT_ONE);
      const missing = await c.say(first, "after_dive_2", "not_boarded", "2026-08-01T16:40:00.000Z");
      await c.say(first, "after_dive_2", "cleared", "2026-08-15T11:30:00.000Z", missing);
      return c;
    }

    it("still asks for the second Saturday's dock count when nobody has counted that day", async () => {
      const c = await undoneEarlyOnDayTwo();
      expect(await c.gaps("2026-08-15T19:00:00.000Z")).toMatchObject([
        { reason: "no_roll_call", dayNumber: 2, uncounted: 2 },
        // Taken back, Saturday's dive 2 reads as not yet counted, never as missing.
        { reason: "after_dive_uncounted", dayNumber: 1, diveNumber: 2, uncounted: 1 },
      ]);
    });

    it("still raises the second Saturday's uncounted dive 1 once they board", async () => {
      const c = await undoneEarlyOnDayTwo();
      for (const id of c.bookingIds)
        await c.say(id, "departure", "boarded", "2026-08-15T12:45:00.000Z");
      expect(await c.gaps("2026-08-15T19:00:00.000Z")).toMatchObject([
        { reason: "after_dive_uncounted", dayNumber: 2, diveNumber: 1, uncounted: 2 },
      ]);
    });

    it("never numbers the day on from an undo that names nothing, or from a repeated undo", async () => {
      const c = await course();
      const [first] = c.bookingIds as [string, string];
      await c.countDay(SAT_ONE);
      await c.say(first, "after_dive_2", "cleared", "2026-08-15T11:30:00.000Z");
      await c.say(first, "after_dive_2", "cleared", "2026-08-15T11:31:00.000Z");
      expect(await c.gaps("2026-08-15T19:00:00.000Z")).toMatchObject([
        { reason: "no_roll_call", dayNumber: 2, uncounted: 2 },
      ]);
    });

    it("asks for the day's dock count again once a stray later-checkpoint tap is undone", async () => {
      const c = await course();
      const [first] = c.bookingIds as [string, string];
      await c.countDay(SAT_ONE);
      const stray = await c.say(first, "after_dive_2", "boarded", "2026-08-15T11:30:00.000Z");
      await c.say(first, "after_dive_2", "cleared", "2026-08-15T11:31:00.000Z", stray);
      expect(await c.gaps("2026-08-15T19:00:00.000Z")).toMatchObject([
        { reason: "no_roll_call", dayNumber: 2, uncounted: 2 },
      ]);
    });

    it("still numbers on from a real count at a later checkpoint beside an undo", async () => {
      const c = await undoneEarlyOnDayTwo();
      for (const id of c.bookingIds)
        await c.say(id, "after_dive_2", "boarded", "2026-08-15T16:00:00.000Z");
      expect(await c.gaps("2026-08-15T19:00:00.000Z")).toEqual([]);
    });
  });
});

describe("a weekend course that numbers its dives across the run", () => {
  it("reads day two's dives 1 and 2 from day one when day two logs dives 3 and 4", async () => {
    const c = await course();
    const sat = at(SAT_ONE.start).getTime();
    const sun = at(SAT_TWO.start).getTime();
    const iso = (ms: number) => new Date(ms).toISOString();
    for (const id of c.bookingIds) {
      await c.say(id, "departure", "boarded", iso(sat - 15 * 60_000));
      await c.say(id, "after_dive_1", "boarded", iso(sat + 60 * 60_000));
      await c.say(id, "after_dive_2", "boarded", iso(sat + 180 * 60_000));
    }
    // The fixture plans two dives; a four-dive weekend is the same shape one
    // checkpoint up, so day two here logs dive 2 again only.
    for (const id of c.bookingIds) {
      await c.say(id, "after_dive_2", "boarded", iso(sun + 180 * 60_000));
    }
    expect(await c.gaps("2026-08-15T19:00:00.000Z")).toEqual([]);
  });
});

describe("oneRowPerHalf, for a reader drawn once per departure", () => {
  const row = (reason: string, dayNumber: number) =>
    ({ tripId: "t", reason, dayNumber }) as Parameters<typeof oneRowPerHalf>[0][number];

  it("keeps a stated missing person from any day over a newer day's open count", () => {
    const kept = oneRowPerHalf([
      row("after_dive_uncounted", 2),
      row("departure_uncounted", 2),
      row("missing_diver", 1),
      row("crew_uncounted", 2),
      row("crew_uncounted", 1),
    ]);
    expect(kept.map((gap) => [gap.reason, gap.dayNumber])).toEqual([
      ["departure_uncounted", 2],
      ["missing_diver", 1],
      ["crew_uncounted", 2],
    ]);
  });

  it("passes a one-day trip's rows through unchanged", () => {
    const rows = [row("missing_diver", 1), row("crew_uncounted", 1), row("no_roll_call", 1)];
    expect(oneRowPerHalf(rows)).toEqual(rows);
  });
});
