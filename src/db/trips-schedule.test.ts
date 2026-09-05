import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { courses, rollCallCrewEvents, tripDives, trips } from "./schema";
import {
  createTrip,
  deleteTrip,
  duplicateTrip,
  getTripWithBooked,
  listTripScheduleDays,
  moveTrip,
  pagedUpcomingTripsWithCounts,
  upcomingTripsWithCounts,
  updateTrip,
} from "./trips";

describe("moveTrip / duplicateTrip across a DST transition", () => {
  // The seeded blue-mantis shop is America/New_York. Spring-forward in 2026
  // is Sunday March 8 (2am -> 3am). This 3-day course's own days straddle the
  // transition: day 1 (Mar 6) and day 2 (Mar 7) fall before it, EST (UTC-4);
  // day 3 (Mar 8, 07:30 — after the 2am jump) falls after it, EDT (UTC-4).
  // Moved to Mar 13-15 (all EDT, no further transition in between), a naive
  // fixed-millisecond delta computed from the *start's* own EST->EDT crossing
  // over-corrects day 3 (which needed no crossing at all, having already been
  // EDT) and the trip's endsAt by an extra hour. Preserving wall-clock time
  // per calendar day, independent of which offset each day happened to start
  // in, is what this guards.
  const tz = "America/New_York";
  const wall = (day: number, hour: number, minute = 30) =>
    wallTimeToUtc({ year: 2026, month: 3, day, hour, minute }, tz);

  function buildThreeDayCourse(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
  ) {
    return createTrip(db, {
      shopId,
      title: "DST regression — three-day course",
      startsAt: wall(6, 7),
      endsAt: wall(8, 16, 0),
      capacity: 4,
      scheduleDays: [
        { dayNumber: 1, startsAt: wall(6, 7), endsAt: wall(6, 16, 0) },
        { dayNumber: 2, startsAt: wall(7, 7), endsAt: wall(7, 16, 0) },
        { dayNumber: 3, startsAt: wall(8, 7), endsAt: wall(8, 16, 0) },
      ],
    });
  }

  it("moveTrip preserves each schedule day's wall-clock hour across spring-forward", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await buildThreeDayCourse(db, shop.id);
    if (!source) throw new Error("source trip not created");

    const outcome = await moveTrip(db, shop.id, source.id, wall(13, 7));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(utcToWallTime(outcome.trip.startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(outcome.trip.endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });

    const days = await listTripScheduleDays(db, shop.id, source.id);
    expect(days).toHaveLength(3);
    const byDay = Object.fromEntries(days.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(byDay[1].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[2].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });
  });

  it("duplicateTrip preserves each schedule day's wall-clock hour across spring-forward", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await buildThreeDayCourse(db, shop.id);
    if (!source) throw new Error("source trip not created");

    const copy = await duplicateTrip(db, shop.id, source.id, wall(13, 7));
    if (!copy) throw new Error("duplicate not created");

    expect(utcToWallTime(copy.startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(copy.endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });

    const days = await listTripScheduleDays(db, shop.id, copy.id);
    expect(days).toHaveLength(3);
    const byDay = Object.fromEntries(days.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(byDay[1].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[2].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });
    // The source trip's own days must be untouched by the duplicate.
    const sourceDays = await listTripScheduleDays(db, shop.id, source.id);
    const sourceByDay = Object.fromEntries(sourceDays.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(sourceByDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 8,
      hour: 7,
      minute: 30,
    });
  });
});

describe("moveTrip / duplicateTrip when the start's clock time also changes", () => {
  // A move isn't always "same time, new day" — the schedule builder lets
  // staff pick a new date *and* a new departure time in one step. endsAt (and
  // any other schedule day) must carry that time-of-day change too, or the
  // trip's duration silently changes: a departure created 09:00-13:00 (4h)
  // and moved to 07:15 must land at 07:15-11:15, not stay stuck at 13:00.
  const tz = "America/New_York";
  const wall = (day: number, hour: number, minute = 0) =>
    wallTimeToUtc({ year: 2026, month: 6, day, hour, minute }, tz);

  it("moveTrip shifts endsAt by the same wall-clock delta as the new start time", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Time-change regression",
      startsAt: wall(10, 9, 0),
      endsAt: wall(10, 13, 0),
      capacity: 4,
    });
    if (!source) throw new Error("source trip not created");

    const outcome = await moveTrip(db, shop.id, source.id, wall(12, 7, 15));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(utcToWallTime(outcome.trip.startsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 7,
      minute: 15,
    });
    expect(utcToWallTime(outcome.trip.endsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });

  it("duplicateTrip shifts endsAt by the same wall-clock delta as the new start time", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Time-change regression",
      startsAt: wall(10, 9, 0),
      endsAt: wall(10, 13, 0),
      capacity: 4,
    });
    if (!source) throw new Error("source trip not created");

    const copy = await duplicateTrip(db, shop.id, source.id, wall(12, 7, 15));
    if (!copy) throw new Error("duplicate not created");

    expect(utcToWallTime(copy.startsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 7,
      minute: 15,
    });
    expect(utcToWallTime(copy.endsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });
});

describe("schedule edits after roll-call evidence", () => {
  it("refuses move and delete after a head count, but deletes an untouched trip", async () => {
    const { db, shop } = await seededShopContext();
    const staffId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const sailed = await createTrip(db, {
      shopId: shop.id,
      title: "Roll-call guard regression",
      startsAt: new Date("2099-06-10T13:00:00.000Z"),
      endsAt: new Date("2099-06-10T17:00:00.000Z"),
      capacity: 8,
      plannedDives: 1,
    });
    if (!sailed) throw new Error("failed to create trip");

    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: sailed.id,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date("2099-06-10T12:00:00.000Z"),
    });

    expect(await moveTrip(db, shop.id, sailed.id, new Date("2099-06-11T13:00:00.000Z"))).toEqual({
      ok: false,
      reason: "already_sailed",
    });
    expect(await deleteTrip(db, shop.id, sailed.id)).toEqual({
      ok: false,
      reason: "already_sailed",
    });

    const untouched = await createTrip(db, {
      shopId: shop.id,
      title: "Untouched schedule row",
      startsAt: new Date("2099-06-12T13:00:00.000Z"),
      endsAt: new Date("2099-06-12T17:00:00.000Z"),
      capacity: 8,
      plannedDives: 1,
    });
    if (!untouched) throw new Error("failed to create untouched trip");
    expect(await deleteTrip(db, shop.id, untouched.id)).toEqual({ ok: true });
  });

  it("stamps a deleted departure instead of removing it, and takes it off every board read", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Deleted departure",
      startsAt: new Date("2099-07-02T13:00:00.000Z"),
      endsAt: new Date("2099-07-02T17:00:00.000Z"),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create trip");

    const before = await listTripScheduleDays(db, shop.id, trip.id);
    expect(await deleteTrip(db, shop.id, trip.id)).toEqual({ ok: true });

    // The row survives, stamped. This is the half that makes the delete
    // reversible; everything below is the half that makes it invisible.
    const [row] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);

    // The children stay attached — they were hard-deleted before this change,
    // which is exactly what made putting a departure back a rebuild.
    expect(await db.select().from(tripDives).where(eq(tripDives.tripId, trip.id))).not.toHaveLength(
      0,
    );
    expect(before.length).toBeGreaterThan(0);

    // And no board read finds it: the staff schedule, the public schedule, and
    // the resolver the trip page and the public booking page both go through.
    expect(await getTripWithBooked(db, shop.id, trip.id)).toBeNull();
    const upcoming = await upcomingTripsWithCounts(
      db,
      shop.id,
      new Date("2099-07-01T00:00:00.000Z"),
    );
    expect(upcoming.map((row) => row.id)).not.toContain(trip.id);
    const publicBoard = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now: new Date("2099-07-01T00:00:00.000Z"),
      publicOnly: true,
      limit: 50,
    });
    expect(publicBoard.trips.map((row) => row.id)).not.toContain(trip.id);
  });

  it("answers not_found on a second delete, and leaves the first stamp alone", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Deleted once",
      startsAt: new Date("2099-07-03T13:00:00.000Z"),
      endsAt: new Date("2099-07-03T17:00:00.000Z"),
      capacity: 8,
      plannedDives: 1,
    });
    if (!trip) throw new Error("failed to create trip");

    expect(await deleteTrip(db, shop.id, trip.id)).toEqual({ ok: true });
    const [first] = await db.select().from(trips).where(eq(trips.id, trip.id));

    // The guard read at the top of `deleteTrip` filters deleted rows like every
    // other resolver, so a replayed submit finds nothing rather than re-stamping
    // a later time over the moment the departure actually came off the board.
    expect(await deleteTrip(db, shop.id, trip.id)).toEqual({ ok: false, reason: "not_found" });
    const [second] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());

    // Same reasoning for the move beside it: a deleted departure is not on the
    // board, so it is not a schedule edit to make.
    expect(await moveTrip(db, shop.id, trip.id, new Date("2099-07-04T13:00:00.000Z"))).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

/**
 * **A copy of a self-guided departure is still self-guided** (issue #973).
 *
 * `trips.self_guided` silences the Today queue's `uncrewed_departure` row for a
 * departure the shop has said runs without an in-water guide. Every path that
 * *clones* a departure has to carry it, or the mark quietly stops holding on
 * the copies — and the shop most likely to set it is the one running a standing
 * weekly unguided charter, where every instance is a clone. Losing it there
 * would leave the warning-toned row firing forever on exactly the shop the
 * feature exists for, which is the failure it was built to prevent.
 *
 * Caught in review of PR #1041, where `duplicateTrip` and the series
 * materialization both copied `isPrivate` beside it and neither copied this.
 */
describe("a self-guided departure keeps its mark when copied", () => {
  it("carries self_guided through duplicateTrip", async () => {
    const { db, shop } = await seededShopContext();
    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Standing shore dive — buddy pairs",
      startsAt: wallTimeToUtc({ year: 2026, month: 9, day: 5, hour: 8, minute: 0 }, shop.timezone),
      endsAt: wallTimeToUtc({ year: 2026, month: 9, day: 5, hour: 12, minute: 0 }, shop.timezone),
      capacity: 8,
      plannedDives: 2,
      selfGuided: true,
    });
    if (!source) throw new Error("failed to create the source departure");
    expect(source.selfGuided).toBe(true);

    const copied = await duplicateTrip(
      db,
      shop.id,
      source.id,
      wallTimeToUtc({ year: 2026, month: 9, day: 12, hour: 8, minute: 0 }, shop.timezone),
    );

    if (!copied) throw new Error("duplicateTrip returned nothing");
    const [row] = await db.select().from(trips).where(eq(trips.id, copied.id));
    expect(row?.selfGuided).toBe(true);
  });
});

/**
 * **A course session is never self-guided** (issue #1342).
 *
 * Self-guided means the divers go in unguided in buddy pairs; a certification
 * dive requires the instructor present and supervising, under every agency the
 * glossary lists. The two cannot both be true of one departure, and until this
 * nothing refused the combination — the schedule builder offered the checkbox
 * beside the course picker and `insertTripInstance` wrote whatever it was sent.
 *
 * Refused at `insertTripInstance` rather than at `createTrip` because that is
 * the one function all three creation doors pass through. `duplicateTrip` gets
 * its own case below: it copies `source.selfGuided` straight in, and the series
 * horizon roll does the same thing nightly, forever, so a template holding the
 * state would re-mint it indefinitely.
 *
 * The *detector* is deliberately untouched. A course session short of its
 * instructor still raises the instructor gap, because `courseCrewGap` takes no
 * `selfGuided` parameter and must never grow one (ADR
 * 20260827-self-guided-departures). This refuses the input; that ADR governs
 * the output.
 */
describe("a course session is never self-guided", () => {
  async function aCourse(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shopId))
      .limit(1);
    if (!course) throw new Error("seeded shop has no course");
    return course.id;
  }

  it("refuses the mark at creation, even when the caller asks for it", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: await aCourse(db, shop.id),
      title: "Open Water — session 1",
      startsAt: wallTimeToUtc({ year: 2026, month: 9, day: 5, hour: 8, minute: 0 }, shop.timezone),
      endsAt: wallTimeToUtc({ year: 2026, month: 9, day: 5, hour: 12, minute: 0 }, shop.timezone),
      capacity: 6,
      plannedDives: 2,
      selfGuided: true,
    });
    if (!trip) throw new Error("failed to create the course session");
    const [row] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(row?.selfGuided).toBe(false);
  });

  /**
   * The path most likely to regress: it does not go through `createTrip` at
   * all, and it copies the flag rather than being told it. A trip that somehow
   * already holds the state must not propagate it.
   */
  it("does not let a copy carry it onto a course session", async () => {
    const { db, shop } = await seededShopContext();
    const courseId = await aCourse(db, shop.id);
    const source = await createTrip(db, {
      shopId: shop.id,
      courseId,
      title: "Open Water — session 2",
      startsAt: wallTimeToUtc({ year: 2026, month: 9, day: 6, hour: 8, minute: 0 }, shop.timezone),
      endsAt: wallTimeToUtc({ year: 2026, month: 9, day: 6, hour: 12, minute: 0 }, shop.timezone),
      capacity: 6,
      plannedDives: 2,
    });
    if (!source) throw new Error("failed to create the source departure");
    // Written behind the writer's back, which is the only way to reach the
    // state now — exactly the shape a row predating this rule would have.
    await db.update(trips).set({ selfGuided: true }).where(eq(trips.id, source.id));

    const copied = await duplicateTrip(
      db,
      shop.id,
      source.id,
      wallTimeToUtc({ year: 2026, month: 9, day: 13, hour: 8, minute: 0 }, shop.timezone),
    );
    if (!copied) throw new Error("duplicateTrip returned nothing");
    const [row] = await db.select().from(trips).where(eq(trips.id, copied.id));
    expect(row?.selfGuided).toBe(false);
  });

  it("refuses the mark on an edit, read against the row's own course", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: await aCourse(db, shop.id),
      title: "Open Water — session 3",
      startsAt: wallTimeToUtc({ year: 2026, month: 9, day: 7, hour: 8, minute: 0 }, shop.timezone),
      endsAt: wallTimeToUtc({ year: 2026, month: 9, day: 7, hour: 12, minute: 0 }, shop.timezone),
      capacity: 6,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create the course session");

    // `UpdateTripPatch` carries no `courseId` — a departure's course is fixed
    // at creation — so the refusal has to read the existing row inside the
    // transaction. A patch that could be trusted for the course would be no
    // guard at all.
    const result = await updateTrip(db, shop.id, trip.id, {
      title: "Open Water — session 3",
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: 6,
      plannedDives: 2,
      selfGuided: true,
    });
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(row?.selfGuided).toBe(false);
  });

  it("still lets a fun dive be marked self-guided", async () => {
    // The rule is about course sessions, not about the mark. A guard that took
    // the feature down with the incoherent state would be worse than the state.
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Standing shore dive — buddy pairs",
      startsAt: wallTimeToUtc({ year: 2026, month: 9, day: 8, hour: 8, minute: 0 }, shop.timezone),
      endsAt: wallTimeToUtc({ year: 2026, month: 9, day: 8, hour: 12, minute: 0 }, shop.timezone),
      capacity: 8,
      plannedDives: 2,
      selfGuided: true,
    });
    if (!trip) throw new Error("failed to create the shore dive");
    const [row] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(row?.selfGuided).toBe(true);
  });
});

/**
 * **The calendar revision counter** (issue #1165). `trips.revision` ships as
 * RFC 5545 `SEQUENCE` from both calendar surfaces, so a move has to bump it —
 * a client that sees an unchanged sequence may keep the old `DTSTART`, which
 * puts a diver at a dock at the old time — and a no-op drag must not.
 */
describe("moveTrip and the calendar revision", () => {
  const at = (day: number, hour: number, tz: string) =>
    wallTimeToUtc({ year: 2026, month: 9, day, hour, minute: 0 }, tz);

  it("bumps by exactly one when the departure really moves, and not at all when it does not", async () => {
    const { db, shop } = await seededShopContext();
    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Revision — a boat that moves",
      startsAt: at(5, 8, shop.timezone),
      endsAt: at(5, 12, shop.timezone),
      capacity: 6,
    });
    if (!source) throw new Error("failed to create the departure");
    expect(source.revision).toBe(0);

    const moved = await moveTrip(db, shop.id, source.id, at(6, 8, shop.timezone));
    expect(moved.ok).toBe(true);
    const [afterMove] = await db.select().from(trips).where(eq(trips.id, source.id));
    expect(afterMove?.revision).toBe(1);

    // `moveTrip` early-returns on an unchanged instant, so this proves the bump
    // cannot fire on a drag that puts the boat back where it already was.
    const again = await moveTrip(db, shop.id, source.id, at(6, 8, shop.timezone));
    expect(again.ok).toBe(true);
    const [afterNoop] = await db.select().from(trips).where(eq(trips.id, source.id));
    expect(afterNoop?.revision).toBe(1);
  });

  it("gives a copy revision 0 however many times the source has moved", async () => {
    const { db, shop } = await seededShopContext();
    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Revision — a boat that gets copied",
      startsAt: at(5, 8, shop.timezone),
      endsAt: at(5, 12, shop.timezone),
      capacity: 6,
    });
    if (!source) throw new Error("failed to create the departure");
    await moveTrip(db, shop.id, source.id, at(7, 8, shop.timezone));
    await moveTrip(db, shop.id, source.id, at(8, 8, shop.timezone));

    // A copy is a new row with a new UID, so no subscriber holds a revision of
    // it to compare against — starting anywhere but zero would be a lie.
    const copied = await duplicateTrip(db, shop.id, source.id, at(12, 8, shop.timezone));
    if (!copied) throw new Error("duplicateTrip returned nothing");
    const [row] = await db.select().from(trips).where(eq(trips.id, copied.id));
    expect(row?.revision).toBe(0);
  });
});
