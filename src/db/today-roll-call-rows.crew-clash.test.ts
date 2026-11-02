import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { assembleDaySpine, sortStationRows } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { recordCrewRollCall, recordRollCall } from "./manifests";
import {
  bookings as bookingsTable,
  people,
  personRoles as personRolesTable,
  rollCallEvents as rollCallEventsTable,
  trips as tripsTable,
} from "./schema";
import { getTodayWork } from "./today";
import { createTrip, listStaff, moveTrip, setTripCrew, setTripStatus } from "./trips";

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

/**
 * **A crew clash on the surface a shop starts its morning on** (H-20260916-may-one-hull-carry, issues
 * #1776 and #1814).
 *
 * A clash is the one crew fault invisible on both boats: each shows a full crew
 * list. Before the boat sails it is a `crew_clash` row on each departure, read
 * through `crewClashesByTrip` in one batch. After it sails and until it is home
 * it is a `crew_clash_sailed` row — the narrow version H-20260916-may-one-hull-carry chose, read from the
 * roster rather than from roll-call events, so a shop that never taps a crew
 * roll call still raises no crew roll-call row.
 *
 * Every setup reaches the state the way a shop does: the roster refuses to
 * write an overlap, so the crew go on while the windows are clear and a move
 * lands one boat on the other. A person of the test's own, so a seeded
 * departure cannot clash with them by accident.
 */
describe("crew clashes on Today (H-20260916-may-one-hull-carry)", () => {
  const HOUR = 60 * 60 * 1000;

  async function divemaster(name: string) {
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: name })
      .returning({ id: people.id });
    if (!person) throw new Error("fixture insert failed");
    await db.insert(personRolesTable).values({ personId: person.id, role: "divemaster" });
    return person.id;
  }

  /**
   * The 09:00-style host (`hostStartsAt` for four hours) and a mover that ties
   * up an hour and a half before it sails, both crewed by one person; then the
   * mover slides to `moveTo`.
   */
  async function movedOnto(hostStartsAt: Date, moveTo: Date) {
    const { db, shop } = ctx;
    const personId = await divemaster("Kai Clashwell");
    const host = await createTrip(db, {
      shopId: shop.id,
      title: "Clash host reef",
      startsAt: hostStartsAt,
      endsAt: new Date(hostStartsAt.getTime() + 4 * HOUR),
      capacity: 6,
    });
    const mover = await createTrip(db, {
      shopId: shop.id,
      title: "Clash mover charter",
      startsAt: new Date(hostStartsAt.getTime() - 3 * HOUR),
      endsAt: new Date(hostStartsAt.getTime() - 1.5 * HOUR),
      capacity: 6,
    });
    if (!host || !mover) throw new Error("departures not created");
    expect(await setTripCrew(db, shop.id, host.id, [personId])).toBe(true);
    expect(await setTripCrew(db, shop.id, mover.id, [personId])).toBe(true);
    expect((await moveTrip(db, shop.id, mover.id, moveTo)).ok).toBe(true);
    return { host, mover, personId };
  }

  /** The shop home's spine for `now`, with no second day to file onto. */
  async function spineAt(now: Date) {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    return assembleDaySpine(work, { departures: [], actions: [] });
  }

  /** The one Needs you list, ranked the way DaySpine ranks it. */
  function needsYou(spine: Awaited<ReturnType<typeof spineAt>>) {
    return sortStationRows([...spine.stations.flatMap((station) => station.rows), ...spine.desk]);
  }

  async function clashRows(now: Date, tripIds: readonly string[]) {
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    return work.actions.filter(
      (action) =>
        (action.kind === "crew_clash" || action.kind === "crew_clash_sailed") &&
        tripIds.includes(action.departure?.tripId ?? ""),
    );
  }

  // Issue #2211: one person on two boats is one fact, said once, as the
  // staffing week says it. The row sits on the earlier departure and names the
  // other, so a shop reads one row where it used to read two.
  it("raises one crew_clash for the pair, on the earlier departure, naming the other boat", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, new Date(hostStartsAt.getTime() - HOUR));

    const rows = await clashRows(now, [host.id, mover.id]);
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      [`crew-clash:${mover.id}`, "crew_clash"],
    ]);
    expect(rows[0]).toMatchObject({
      aboutDeparture: true,
      urgency: "soon",
      detail: "Kai Clashwell is also rostered on Clash host reef at these hours.",
      href: `/shop/${ctx.shop.slug}/trips/${mover.id}?view=details#crew`,
    });
  });

  it("still says it once when the two sail at the same minute", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    const rows = await clashRows(now, [host.id, mover.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("crew_clash");
  });

  // Issue #2788: at the same minute the row sat on whichever trip id sorted
  // first, and ids are minted fresh by every seed, so the row (and the Needs
  // you group it leads) swapped boats between runs. Titles are chosen against
  // the ids here, so an id tiebreak puts it on the wrong one every time.
  it("puts a same-minute clash on the departure whose title reads first, whatever the ids", async () => {
    const { db } = ctx;
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    const [lowId, highId] = [host.id, mover.id].sort((a, b) => a.localeCompare(b));
    if (!lowId || !highId) throw new Error("fixture");
    await db.update(tripsTable).set({ title: "Two-Tank Reef" }).where(eq(tripsTable.id, lowId));
    await db.update(tripsTable).set({ title: "Morning Two-Tank" }).where(eq(tripsTable.id, highId));
    const rows = await clashRows(now, [host.id, mover.id]);
    expect(rows.map((row) => row.id)).toEqual([`crew-clash:${highId}`]);
  });

  it("leaves a crew member handed from one boat to the next alone", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    // The mover lands so it ties up the minute the host sails: nose to tail.
    const { host, mover } = await movedOnto(
      hostStartsAt,
      new Date(hostStartsAt.getTime() - 1.5 * HOUR),
    );
    expect(await clashRows(now, [host.id, mover.id])).toEqual([]);
  });

  it("ignores a called-off departure on either side", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    await setTripStatus(ctx.db, ctx.shop.id, host.id, "cancelled");
    expect(await clashRows(now, [host.id, mover.id])).toEqual([]);
  });

  it("says nothing once the clash is cleared", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() + 2 * 24 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    expect(await setTripCrew(ctx.db, ctx.shop.id, mover.id, [])).toBe(true);
    expect(await clashRows(now, [host.id, mover.id])).toEqual([]);
  });

  /**
   * #1814's narrow version: the boat is out with somebody also rostered on
   * another hull. One row, named, pointing at the roll call — and the
   * pre-sailing kind is gone, because there is no "before it sails" left.
   */
  it("raises crew_clash_sailed on a departure underway, and only while it is out", async () => {
    const now = nowDate();
    // Host sailed an hour ago and is out for three more; the mover is slid
    // onto it.
    const hostStartsAt = new Date(now.getTime() - HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);

    const rows = await clashRows(now, [host.id, mover.id]);
    expect(rows.map((row) => row.kind)).toEqual(["crew_clash_sailed", "crew_clash_sailed"]);
    const onHost = rows.find((row) => row.departure?.tripId === host.id);
    expect(onHost).toMatchObject({
      id: `crew-clash-sailed:${host.id}`,
      urgency: "imminent",
      aboutDeparture: true,
      detail:
        "Kai Clashwell is out aboard while also rostered on Clash mover charter at these hours. Confirm who is aboard.",
      href: `/shop/${ctx.shop.slug}/trips/${host.id}/manifest`,
    });

    // The mover is a ninety-minute boat: home (a buffered hour past its
    // return) while the host is still out, so only the host still speaks.
    const moverHome = new Date(hostStartsAt.getTime() + 2.6 * HOUR);
    expect((await clashRows(moverHome, [host.id, mover.id])).map((row) => row.id)).toEqual([
      `crew-clash-sailed:${host.id}`,
    ]);
    // Both home: silent. The clash on a returned boat is permanent and
    // unfixable, which is the warning a shop learns to scroll past.
    const bothHome = new Date(hostStartsAt.getTime() + 5.1 * HOUR);
    expect(await clashRows(bothHome, [host.id, mover.id])).toEqual([]);
  });

  /**
   * A clash is decided per leg, not per departure (dive-domain-expert review):
   * a two-day course clashing on its second morning still has the clash to fix
   * while day one is out, a boat out with it on day two, and nothing after.
   */
  it("classifies a multi-day course's clash by the leg it falls on", async () => {
    const { db, shop } = ctx;
    const base = new Date(nowDate().getTime() + 2 * 24 * HOUR);
    const at = (hours: number) => new Date(base.getTime() + hours * HOUR);
    const personId = await divemaster("Rua Twoday");
    const course = await createTrip(db, {
      shopId: shop.id,
      title: "Two-day course",
      startsAt: at(0),
      endsAt: at(28),
      capacity: 4,
      scheduleDays: [
        { dayNumber: 1, startsAt: at(0), endsAt: at(4) },
        { dayNumber: 2, startsAt: at(24), endsAt: at(28) },
      ],
    });
    const charter = await createTrip(db, {
      shopId: shop.id,
      title: "Second-morning charter",
      startsAt: at(10),
      endsAt: at(12),
      capacity: 6,
    });
    if (!course || !charter) throw new Error("departures not created");
    expect(await setTripCrew(db, shop.id, course.id, [personId])).toBe(true);
    expect(await setTripCrew(db, shop.id, charter.id, [personId])).toBe(true);
    expect((await moveTrip(db, shop.id, charter.id, at(25))).ok).toBe(true);

    const onCourse = async (now: Date) =>
      (await clashRows(now, [course.id])).map((row) => [row.kind, row.dueAt?.getTime()]);

    // Day one is out; the clash is on day two, still to sail and still fixable.
    expect(await onCourse(at(1.5))).toEqual([["crew_clash", at(24).getTime()]]);
    // The course started more than an hour ago, so it is no station: the row
    // files at the desk, where Needs you reads it, never into the week's count.
    const dayOne = await spineAt(at(1.5));
    expect(dayOne.stations.map((station) => station.tripId)).not.toContain(course.id);
    expect(needsYou(dayOne).map((row) => row.id)).toContain(`crew-clash:${course.id}`);
    // Day two is out with it.
    expect(await onCourse(at(26))).toEqual([["crew_clash_sailed", at(28).getTime()]]);
    expect(needsYou(await spineAt(at(26))).map((row) => row.id)).toContain(
      `crew-clash-sailed:${course.id}`,
    );
    // Day two is home: permanent, said nowhere.
    expect(await onCourse(at(29.5))).toEqual([]);
  });

  /**
   * A1 of the dive-domain-expert review: a missing diver on the same boat
   * always leads the sailed clash, though both are imminent and the clash's
   * boat may come home first.
   */
  it("dates the sailed clash so a missing diver on a later boat still leads it", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - HOUR);
    const { host } = await movedOnto(hostStartsAt, hostStartsAt);

    // Another boat, out until two hours after the clash boat is home, with a
    // diver counted not back aboard after dive one. Inserted directly: the
    // booking path refuses a seat on a boat that has sailed.
    const [later] = await db
      .insert(tripsTable)
      .values({
        shopId: shop.id,
        title: "Long drift, diver not back",
        startsAt: new Date(now.getTime() - 2 * HOUR),
        endsAt: new Date(host.endsAt.getTime() + 2 * HOUR),
        capacity: 6,
        plannedDives: 2,
        priceCents: 13000,
      })
      .returning();
    if (!later) throw new Error("fixture trip not created");
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    const [staff] = await listStaff(db, shop.id);
    if (!diver || !staff) throw new Error("seed people missing");
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: later.id,
        personId: diver.id,
        status: "checked_in",
      })
      .returning();
    if (!booking) throw new Error("fixture booking not created");
    await db.insert(rollCallEventsTable).values({
      shopId: shop.id,
      tripId: later.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      source: "live",
      occurredAt: new Date(now.getTime() - 2 * HOUR),
    });
    const counted = await recordRollCall(db, {
      shopId: shop.id,
      tripId: later.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
    expect(counted.ok).toBe(true);

    const ids = needsYou(await spineAt(now)).map((action) => action.id);
    const missing = ids.findIndex((id) => id.startsWith(`roll-call:${later.id}:missing_diver:`));
    const clash = ids.indexOf(`crew-clash-sailed:${host.id}`);
    expect(missing).toBeGreaterThanOrEqual(0);
    expect(clash).toBeGreaterThan(missing);
  });

  /**
   * B1 of the re-review: a boat that left more than an hour ago is no longer a
   * station, and its sailed clash used to fall into the week's count behind a
   * link. It files at the desk, still naming its boat.
   */
  it("files a sailed clash two hours out at the desk, not into the week's count", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - 2 * HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    expect(work.outTripIds).toEqual(expect.arrayContaining([host.id, mover.id]));
    const clashIds = [`crew-clash-sailed:${host.id}`, `crew-clash-sailed:${mover.id}`];
    const spine = assembleDaySpine(
      { ...work, actions: work.actions.filter((action) => clashIds.includes(action.id)) },
      { departures: [], actions: [] },
    );
    expect(spine.desk.map((row) => row.id).sort()).toEqual([...clashIds].sort());
    expect(spine.desk.find((row) => row.id === clashIds[0])?.departure?.tripId).toBe(host.id);
    expect(spine.week.jobs).toBe(0);
  });

  /**
   * N2: "Confirm who is aboard" is answered for a person once they have a
   * result at this departure's own checkpoint, so the row stops naming them.
   */
  it("drops a crew member from the sailed row once the departure roll call has them", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - 2 * HOUR);
    const { host, mover, personId } = await movedOnto(hostStartsAt, hostStartsAt);
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: host.id,
      personId,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
      checkpoint: "departure",
    });
    // Answered on the host only: the mover still asks.
    expect((await clashRows(now, [host.id, mover.id])).map((row) => row.id)).toEqual([
      `crew-clash-sailed:${mover.id}`,
    ]);
  });

  it("leaves the roll-call subject rule alone: no crew roll-call row for an untapped crew", async () => {
    const now = nowDate();
    const hostStartsAt = new Date(now.getTime() - HOUR);
    const { host, mover } = await movedOnto(hostStartsAt, hostStartsAt);
    const { db, shop } = ctx;
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const rollCallCrew = work.actions.filter(
      (action) =>
        (action.kind === "roll_call_missing_crew" || action.kind === "roll_call_crew_unfinished") &&
        [host.id, mover.id].includes(action.departure?.tripId ?? ""),
    );
    expect(rollCallCrew).toEqual([]);
  });
});
