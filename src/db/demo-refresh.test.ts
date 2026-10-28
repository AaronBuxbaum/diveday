import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { shopDayBounds } from "@/lib/zoned";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import { captureDepartureBoatSafety } from "./boat-safety";
import { createBoat } from "./boats";
import type { AppDb } from "./client";
import {
  DEMO_SCHEDULE_MIN_RUNWAY_DAYS,
  ensureDemoSailsToday,
  refreshCanonicalDemoSchedule,
} from "./demo-refresh";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { getTripManifest } from "./manifests";
import {
  departureBoatSafetySnapshots,
  executedDives,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  staffCredentials,
  staffShifts,
  tripAssignments,
  tripSeries,
  trips,
  userAccounts,
} from "./schema";
import {
  AT_SEA_DAY_TITLE,
  AT_SEA_DUSK_TITLE,
  bringDemoBoatsAtSeaHome,
  seedBoatAtSea,
} from "./seed-boat-at-sea";
import { LEAD_INSTRUCTOR_NAME, RELIEF_INSTRUCTOR_NAME, staffDefs } from "./seed-cast";
import { DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { upcomingScheduleRange, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();
const historyCtx = fileScopedShopContext({ history: true });

it("rebinds known-unsailed safety provenance atomically when the demo moves a future departure", async () => {
  const { db } = ctx;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Provenance Demo", slug: "provenance-demo", timezone: "UTC", isDemo: true })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [owner] = await db
    .insert(people)
    .values({
      shopId: shop.id,
      fullName: "Demo Owner",
      email: "owner@provenance-demo.demo.invalid",
    })
    .returning({ id: people.id });
  if (!owner) throw new Error("owner missing");
  await db.insert(personRoles).values({ personId: owner.id, role: "owner" });
  await db.insert(userAccounts).values({
    personId: owner.id,
    email: "owner@provenance-demo.demo.invalid",
  });
  const boat = await createBoat(db, shop.id, "Demo Provenance Hull", 12);
  const startsAt = new Date(nowDate().getTime() + 24 * 3_600_000);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Future demo",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 10,
      boatId: boat.id,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  expect(await captureDepartureBoatSafety(db, shop.id, trip.id)).toBe("captured");
  expect(await ensureDemoSailsToday(db, shop.id, "UTC")).toBe("moved");
  const [moved] = await db.select().from(trips).where(eq(trips.id, trip.id));
  const [snapshot] = await db
    .select()
    .from(departureBoatSafetySnapshots)
    .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
  expect(snapshot?.departureStartsAt).toEqual(moved?.startsAt);
});

/**
 * Age a shop's board by `days`, which is what a real deployment does to itself:
 * the seed's dates were fixed at the instant the database was created and the
 * calendar walked on past them. Shifting the rows back is the same picture as
 * letting the clock move forward, and it keeps every assertion below on one
 * clock — the frozen application clock the seed itself anchors to.
 */
async function ageTheBoard(db: AppDb, shopId: string, days: number): Promise<void> {
  const shift = sql.raw(`interval '${days} days'`);
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} - ${shift}`,
      endsAt: sql`${trips.endsAt} - ${shift}`,
    })
    .where(eq(trips.shopId, shopId));
}

/**
 * Push every *upcoming* departure `days` into the future — a healthy schedule
 * with a hole where today should be, which is the state the demo spends most of
 * its six-week cycle in: plenty of departures for a diver to look at, and nothing
 * at all on the day staff actually work.
 *
 * Upcoming only. Shifting the seeded *history* forward as well slides a sailed
 * trip into today, which is exactly the state these tests are trying to create
 * the absence of.
 */
async function pushTheBoardLater(db: AppDb, shopId: string, days: number): Promise<void> {
  const shift = sql.raw(`interval '${days} days'`);
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} + ${shift}`,
      endsAt: sql`${trips.endsAt} + ${shift}`,
    })
    .where(and(eq(trips.shopId, shopId), gte(trips.startsAt, nowDate())));

  // The close-out fixture is an ended departure on today's calendar day, and
  // the boat at sea sailed earlier today. Move both out of the way for tests
  // whose premise is an empty day; production refresh still treats a boat
  // that sailed today as a real boat.
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} - interval '1 day'`,
      endsAt: sql`${trips.endsAt} - interval '1 day'`,
    })
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(trips.title, [DEMO_COMPLETED_TRIP_TITLE, AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE]),
      ),
    );
}

/** Every scheduled departure, oldest first — ids and times, to prove what moved. */
async function board(db: AppDb, shopId: string) {
  return db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled")))
    .orderBy(asc(trips.startsAt));
}

/** Just the departures still ahead — the pool the today nudge picks from. */
async function upcoming(db: AppDb, shopId: string) {
  return db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, nowDate())),
    )
    .orderBy(asc(trips.startsAt));
}

/** Whether anything sails on the shop's own calendar day containing `now`. */
async function sailsToday(db: AppDb, shopId: string, timeZone: string): Promise<boolean> {
  const { from, to } = shopDayBounds(nowDate(), timeZone);
  const rows = await board(db, shopId);
  return rows.some((trip) => trip.startsAt >= from && trip.startsAt < to);
}

/** Days of departures left on the board, the same measure the pass reads. */
async function runwayDays(db: AppDb, shopId: string): Promise<number> {
  const now = nowDate();
  const { last } = await upcomingScheduleRange(db, shopId, now);
  return last ? Math.floor((last.getTime() - now.getTime()) / DAY_MS) : 0;
}

describe("refreshCanonicalDemoSchedule", () => {
  it("restores a board that has sailed out from under the seed", async () => {
    const { db, shop } = historyCtx;
    const seededRunway = await runwayDays(db, shop.id);

    // The bug this exists for. Every seeded departure is anchored to the moment
    // the database was seeded, that seed runs exactly once, and about two
    await ageTheBoard(db, shop.id, seededRunway + 2);
    expect((await upcomingScheduleRange(db, shop.id)).first).toBeNull();

    const result = await refreshCanonicalDemoSchedule(db);
    expect(result).toEqual({ found: true, runwayDays: 0, refreshed: true, today: "restored" });

    // A board again, and one with real depth to it — not a single boat that
    // will strand the next visitor a day later.
    const { first } = await upcomingScheduleRange(db, shop.id);
    if (!first) throw new Error("expected a restored board to have a next departure");
    expect(await runwayDays(db, shop.id)).toBeGreaterThanOrEqual(DEMO_SCHEDULE_MIN_RUNWAY_DAYS);
    // The demo's own promise: a boat sails today, whenever the demo is opened
    // (`demoTodayDepartureStart`).
    expect(first.getTime() - nowDate().getTime()).toBeLessThan(DAY_MS);
  });

  it("leaves the staff and their logins in place while it restores the schedule", async () => {
    // This pass runs unattended against the shop the marketing site points at,
    // so what it must never do is take the demo's sign-ins with it —
    // `resetDemoSchedule` restores only the playground half by design (ADR
    // 20260718-demo-mode), and nothing else here would notice if that changed.
    const { db, shop } = historyCtx;
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) + 2);

    await refreshCanonicalDemoSchedule(db);

    const accounts = await db
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
    expect(accounts).toHaveLength(1);
  });

  /**
   * The stable half of the demo is seeded **once**, when the shop is created.
   * The canonical demo in production was created months ago and has been
   * carried forward by migrations ever since, so every time `staffDefs` gains a
   * member that shop is a person short of the cast the current code expects —
   * and `seedDemoSchedule` looks the instructors up by name and threw
   * ("seed: relief instructor missing from stable staff"). The reset rolled
   * back with it, so the only symptom was this pass answering 503 every night
   * while the board quietly aged (production, 2026-08-14, after DOM-M7 added
   * the shop's second instructor).
   */
  it("restores a cast member the shop was seeded before, instead of failing the pass", async () => {
    const { db, shop } = historyCtx;
    const relief = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, RELIEF_INSTRUCTOR_NAME)));
    expect(relief).toHaveLength(1);
    // A shop as it looks when it was seeded by a version of this code that had
    // never heard of her.
    await db.delete(tripAssignments).where(eq(tripAssignments.personId, relief[0].id));
    await db.delete(rollCallCrewEvents).where(eq(rollCallCrewEvents.personId, relief[0].id));
    await db.delete(staffShifts).where(eq(staffShifts.personId, relief[0].id));
    await db.delete(staffCredentials).where(eq(staffCredentials.personId, relief[0].id));
    await db.delete(personRoles).where(eq(personRoles.personId, relief[0].id));
    await db.delete(people).where(eq(people.id, relief[0].id));
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) + 2);

    await expect(refreshCanonicalDemoSchedule(db)).resolves.toMatchObject({ refreshed: true });

    // Back on the roster with her role, which is what the seed looks her up by.
    const restored = await db
      .select({ id: people.id, role: personRoles.role })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, RELIEF_INSTRUCTOR_NAME)))
      .orderBy(asc(personRoles.role));
    expect(restored).toEqual([
      { id: expect.any(String), role: "instructor" },
      { id: expect.any(String), role: "captain" },
    ]);
    // …and on the rostering surface, like every other member of the cast — a
    // person restored without their shift is a different wrong answer.
    const shifts = await db
      .select({ note: staffShifts.note })
      .from(staffShifts)
      .where(eq(staffShifts.personId, restored[0].id));
    expect(shifts).toEqual(shifts.map(() => ({ note: null })));
    expect(shifts.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * A diver is called whatever the booking form was given, and
   * `e2e/returning-diver.spec.ts` books a seat as "Sal Moretti" — the seeded
   * captain's own name. An earlier cut of the repair keyed the cast by name and
   * handed that diver the `captain` role: the shop then had two captains,
   * `seedDemoSchedule` rostered whichever the role lookup returned first, and
   * the real captain's Today lost the boat they crew. A staff role granted to a
   * customer is the serious half; the failing lens test was only the symptom.
   */
  it("never mistakes a diver who shares a staff member's name for that staff member", async () => {
    const { db, shop } = historyCtx;
    // Read off the cast rather than typed here, so this keeps testing the
    // captain even if the demo's crew is recast.
    const captain = staffDefs.find((member) => member.fullName === "Sal Moretti");
    if (!captain) throw new Error("seed-cast: no captain Sal Moretti in staffDefs");
    // The same booking `e2e/returning-diver.spec.ts` makes: the captain's name,
    // the diver's own address.
    const [impostor] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: captain.fullName, email: "sal@example.com" })
      .returning({ id: people.id });
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) + 2);

    await refreshCanonicalDemoSchedule(db);

    // Whatever became of the booking, the diver is not on the crew.
    const granted = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, impostor.id));
    expect(granted).toEqual([]);
    // And the shop still has exactly one Sal Moretti with the captain role.
    const captains = await db
      .select({ fullName: people.fullName, email: people.email })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "captain")))
      .orderBy(asc(people.fullName));
    expect(captains).toEqual([
      { fullName: captain.fullName, email: `${captain.local}@demo.invalid` },
      { fullName: "Talia Okonkwo", email: "talia@demo.invalid" },
    ]);
  });

  /** A role lost on its own is the same outage: the lookups join through `person_roles`. */
  it("restores a cast member's missing role", async () => {
    const { db, shop } = historyCtx;
    const [lead] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, LEAD_INSTRUCTOR_NAME)));
    await db.delete(personRoles).where(eq(personRoles.personId, lead.id));
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) + 2);

    await expect(refreshCanonicalDemoSchedule(db)).resolves.toMatchObject({ refreshed: true });

    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, lead.id));
    expect(roles).toEqual([{ role: "instructor" }]);
  });

  it("leaves a board with weeks of departures on it alone", async () => {
    const { db, shop } = ctx;
    const before = await upcomingTripsWithCounts(db, shop.id);

    const result = await refreshCanonicalDemoSchedule(db);

    expect(result.refreshed).toBe(false);
    // Freshly seeded, so a boat already sails today and the narrow pass has
    // nothing to do either — a healthy demo is touched by neither.
    expect(result.today).toBe("already");
    expect(result.runwayDays).toBeGreaterThanOrEqual(DEMO_SCHEDULE_MIN_RUNWAY_DAYS);
    // Not merely "still has trips": the same trips, so a nightly pass over a
    // healthy demo can never churn the shop a visitor is looking at.
    expect((await upcomingTripsWithCounts(db, shop.id)).map((trip) => trip.id)).toEqual(
      before.map((trip) => trip.id),
    );
  });

  it("restores as soon as the board runs below the threshold, not once it is empty", async () => {
    const { db, shop } = historyCtx;
    // Leave one day less than the threshold demands — still a schedule a diver
    // could book from, which is the point: the demo is restored while it still
    // looks like a working dive shop.
    const target = DEMO_SCHEDULE_MIN_RUNWAY_DAYS - 1;
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) - target);

    const result = await refreshCanonicalDemoSchedule(db);

    expect(result.refreshed).toBe(true);
    expect(result.runwayDays).toBe(target);
    expect(await runwayDays(db, shop.id)).toBeGreaterThanOrEqual(DEMO_SCHEDULE_MIN_RUNWAY_DAYS);
  });

  it("puts a boat on today's board without wiping a healthy shop", async () => {
    // The gap the runway threshold cannot close: three weeks of upcoming
    // departures is a healthy demo to a *diver*, and staff still open
    // /shop/blue-mantis to an empty day — for about forty days out of every
    // six-week restore cycle.
    const { db, shop } = historyCtx;
    await pushTheBoardLater(db, shop.id, 4);
    expect(await sailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe(false);
    const before = await board(db, shop.id);
    const [nearest] = await upcoming(db, shop.id);
    const untouched = before.filter((trip) => trip.id !== nearest.id);

    const result = await refreshCanonicalDemoSchedule(db);

    // Moved, not restored: the whole point is that a publicly bookable shop is
    // not deleted and re-seeded to fix one missing row.
    expect(result.refreshed).toBe(false);
    expect(result.today).toBe("moved");
    expect(await sailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe(true);

    const after = await board(db, shop.id);
    // The nearest upcoming departure is the one that moved, and it is the *only*
    // thing that moved — every other trip keeps the time it had.
    const movedIds = after
      .filter((trip) => {
        const was = before.find((row) => row.id === trip.id);
        return was && trip.startsAt.getTime() !== was.startsAt.getTime();
      })
      .map((trip) => trip.id);
    expect(movedIds).toEqual([nearest.id]);
    expect(after).toHaveLength(before.length);
    for (const trip of untouched) {
      const now = after.find((row) => row.id === trip.id);
      expect(now?.startsAt).toEqual(trip.startsAt);
      expect(now?.endsAt).toEqual(trip.endsAt);
    }

    // A two-tank morning stays a two-tank morning: same duration, new start.
    const moved = after.find((trip) => trip.id === nearest.id);
    if (!moved) throw new Error("expected the moved trip to still be on the board");
    expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(
      nearest.endsAt.getTime() - nearest.startsAt.getTime(),
    );
  });

  it("leaves a shop that already has a boat today entirely alone", async () => {
    const { db, shop } = ctx;
    const before = await board(db, shop.id);

    expect(await ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe("already");

    expect(await board(db, shop.id)).toEqual(before);
  });

  it("counts a departure that has already come home as today's board", async () => {
    // "Today has a board" is about the day not being blank, not about a boat
    // still being out: the shop home reads an ended departure as work (its
    // close-out handoff keys on exactly that), so a morning trip that is already
    // back must not trigger a second one being dragged onto today.
    const { db, shop } = ctx;
    const { from } = shopDayBounds(nowDate(), DEMO_SHOP_TIMEZONE);
    const [todaysBoat] = await upcoming(db, shop.id);
    // Park it just after local midnight and give it a short, already-finished run.
    await db
      .update(trips)
      .set({ startsAt: from, endsAt: new Date(from.getTime() + 60 * 60 * 1000) })
      .where(eq(trips.id, todaysBoat.id));
    const before = await board(db, shop.id);

    expect(await ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe("already");

    expect(await board(db, shop.id)).toEqual(before);
  });

  it("never drags a recurring instance off its slot", async () => {
    // A moved series instance keeps its `series_occurrence_date` so the nightly
    // roll does not re-fill the date it left (ADR 20260810-open-ended-recurring-trips),
    // so pulling one onto today would punch a permanent hole in a cadence staff
    // can see. The next non-series departure is moved instead.
    const { db, shop } = historyCtx;
    await pushTheBoardLater(db, shop.id, 4);
    const [nearest, second] = await upcoming(db, shop.id);
    const [series] = await db
      .insert(tripSeries)
      .values({
        shopId: shop.id,
        title: "Standing Saturday charter",
        weekdayMask: 1 << 6,
        anchorDate: "2026-08-01",
        occurrenceCount: 1,
      })
      .returning({ id: tripSeries.id });
    await db
      .update(trips)
      .set({ seriesId: series.id, seriesOccurrenceDate: "2026-08-15" })
      .where(eq(trips.id, nearest.id));

    expect(await ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe("moved");

    const after = await board(db, shop.id);
    const instance = after.find((trip) => trip.id === nearest.id);
    expect(instance?.startsAt).toEqual(nearest.startsAt);
    const movedTrip = after.find((trip) => trip.id === second.id);
    if (!movedTrip) throw new Error("expected the second departure to still be on the board");
    expect(movedTrip.startsAt.getTime()).not.toBe(second.startsAt.getTime());
    expect(await sailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe(true);
  });

  it("does nothing on a database with no canonical demo shop", async () => {
    const db = await unseededTestDb();

    expect(await refreshCanonicalDemoSchedule(db)).toEqual({
      found: false,
      runwayDays: null,
      refreshed: false,
      today: null,
    });
  });

  it("refuses to touch the shop if it is not a demo", async () => {
    // The same guard `/api/test/reset` makes, and the one that matters most
    // here: this pass deletes and re-seeds, and it runs unattended in
    // production. `minRunwayDays` is set past any possible board so the only
    // thing that can stop it is the `isDemo` check.
    const { db, shop } = ctx;
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const before = await upcomingTripsWithCounts(db, shop.id);

    const result = await refreshCanonicalDemoSchedule(db, { minRunwayDays: 10_000 });

    expect(result).toEqual({ found: false, runwayDays: null, refreshed: false, today: null });
    expect((await upcomingTripsWithCounts(db, shop.id)).map((trip) => trip.id)).toEqual(
      before.map((trip) => trip.id),
    );
  });

  /**
   * **The boat at sea's open count closes once she is past her return**
   * (dive-domain review of the demo reseed, item 3). The seed leaves dive 2's
   * count at nine of eleven with a pair and a guide down, as of the instant it
   * ran; left like that past `endsAt` it reads as two divers and a guide lost
   * hours ago with nobody marked missing.
   */
  describe("the boat at sea", () => {
    async function boatAtSea(db: AppDb, shopId: string) {
      const [boat] = await db
        .select()
        .from(trips)
        .where(and(eq(trips.shopId, shopId), eq(trips.title, AT_SEA_DAY_TITLE)));
      if (!boat) throw new Error("expected the boat at sea");
      return boat;
    }
    async function marks(db: AppDb, tripId: string) {
      const divers = await db
        .select({ at: rollCallEvents.occurredAt })
        .from(rollCallEvents)
        .where(eq(rollCallEvents.tripId, tripId));
      const crew = await db
        .select({ at: rollCallCrewEvents.occurredAt })
        .from(rollCallCrewEvents)
        .where(eq(rollCallCrewEvents.tripId, tripId));
      return [...divers, ...crew].map((row) => row.at.getTime());
    }

    it("leaves her count open while she is still due out", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const before = await marks(db, boat.id);

      await refreshCanonicalDemoSchedule(db);

      expect(await marks(db, boat.id)).toEqual(before);
      const afterDiveTwo = await getTripManifest(db, shop.id, boat.id, "after_dive_2");
      expect(afterDiveTwo?.summary.awaiting).toBe(2);
    });

    it("does not fabricate boat-at-sea records for a demo-flagged shop with a real owner account", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const [ownerAccount] = await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .innerJoin(people, eq(people.id, userAccounts.personId))
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
        .limit(1);
      if (!ownerAccount) throw new Error("expected the demo owner account");

      await db
        .update(userAccounts)
        .set({ email: "owner@real-shop.example" })
        .where(eq(userAccounts.id, ownerAccount.id));
      const beforeMarks = await marks(db, boat.id);
      const [beforeDive] = await db
        .select({ id: executedDives.id })
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      const boatsBefore = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
      const [startsBefore] = await db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(eq(trips.id, boat.id));

      await seedBoatAtSea(db, shop.id);
      await expect(ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).resolves.toBe(
        "no_candidate",
      );
      expect(await bringDemoBoatsAtSeaHome(db, new Date(boat.endsAt.getTime() + 60 * 60_000))).toBe(
        0,
      );
      await expect(
        refreshCanonicalDemoSchedule(db, { now: new Date(boat.endsAt.getTime() + 1) }),
      ).resolves.toMatchObject({ found: true, refreshed: false });

      expect(await marks(db, boat.id)).toEqual(beforeMarks);
      const [afterDive] = await db
        .select({ id: executedDives.id })
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      expect(afterDive).toEqual(beforeDive);
      const boatsAfter = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
      expect(boatsAfter).toEqual(boatsBefore);
      const [startsAfter] = await db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(eq(trips.id, boat.id));
      expect(startsAfter).toEqual(startsBefore);
    });

    it("fails closed when the owner is demo-scoped but a captain account is real", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const identities = await db
        .select({ role: personRoles.role, accountId: userAccounts.id, email: userAccounts.email })
        .from(userAccounts)
        .innerJoin(people, eq(people.id, userAccounts.personId))
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "captain"])));
      const owner = identities.find((identity) => identity.role === "owner");
      const captain = identities.find((identity) => identity.role === "captain");
      if (!owner || !captain) throw new Error("expected owner and captain accounts");
      expect(owner.email).toMatch(/@demo\.invalid$/);

      await db
        .update(userAccounts)
        .set({ email: "captain@real-shop.example" })
        .where(eq(userAccounts.id, captain.accountId));

      const beforeMarks = await marks(db, boat.id);
      const boatsBefore = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
      const [startsBefore] = await db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(eq(trips.id, boat.id));

      await seedBoatAtSea(db, shop.id);
      await expect(ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).resolves.toBe(
        "no_candidate",
      );
      expect(await bringDemoBoatsAtSeaHome(db, new Date(boat.endsAt.getTime() + 60 * 60_000))).toBe(
        0,
      );
      await expect(
        refreshCanonicalDemoSchedule(db, { now: new Date(boat.endsAt.getTime() + 1) }),
      ).resolves.toMatchObject({ found: true, refreshed: false });

      expect(await marks(db, boat.id)).toEqual(beforeMarks);
      const diveTwo = await db
        .select({ id: executedDives.id })
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      expect(diveTwo).toHaveLength(0);
      const boatsAfter = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
      expect(boatsAfter).toEqual(boatsBefore);
      const [startsAfter] = await db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(eq(trips.id, boat.id));
      expect(startsAfter).toEqual(startsBefore);
    });

    it("fails closed when a demo-flagged shop has no owner or captain account", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const accountOwners = await db
        .select({ personId: people.id })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "captain"])));
      if (accountOwners.length === 0) throw new Error("expected owner or captain roles");
      await db.delete(userAccounts).where(
        inArray(
          userAccounts.personId,
          accountOwners.map((account) => account.personId),
        ),
      );

      const beforeMarks = await marks(db, boat.id);
      await expect(ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).resolves.toBe(
        "no_candidate",
      );
      expect(await bringDemoBoatsAtSeaHome(db, new Date(boat.endsAt.getTime() + 60 * 60_000))).toBe(
        0,
      );
      await expect(
        refreshCanonicalDemoSchedule(db, { now: new Date(boat.endsAt.getTime() + 1) }),
      ).resolves.toMatchObject({ found: true, refreshed: false });
      expect(await marks(db, boat.id)).toEqual(beforeMarks);
      const logged = await db
        .select({ id: executedDives.id })
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      expect(logged).toHaveLength(0);
    });

    // Issue 2917: the hourly trip-reminder pass runs this alone, so an hour
    // past her return is enough, with no daily restore behind it.
    it("closes her count on the hourly pass an hour past her return, and a second pass writes nothing", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const anHourLater = new Date(boat.endsAt.getTime() + 60 * 60_000);

      expect(await bringDemoBoatsAtSeaHome(db, anHourLater)).toBeGreaterThanOrEqual(1);

      const afterDiveTwo = await getTripManifest(db, shop.id, boat.id, "after_dive_2");
      expect(afterDiveTwo?.summary.awaiting).toBe(0);
      expect(afterDiveTwo?.summary.boarded).toBe(afterDiveTwo?.summary.totalDivers);
      const crewBack = await db
        .select({ personId: rollCallCrewEvents.personId })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.tripId, boat.id),
            eq(rollCallCrewEvents.checkpoint, "after_dive_2"),
          ),
        );
      const crew = await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, boat.id));
      expect(new Set(crewBack.map((row) => row.personId))).toEqual(
        new Set(crew.map((row) => row.personId)),
      );
      const logged = await db
        .select({ id: executedDives.id })
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      expect(logged).toHaveLength(1);

      const settled = await marks(db, boat.id);
      expect(await bringDemoBoatsAtSeaHome(db, anHourLater)).toBe(0);
      expect(await marks(db, boat.id)).toEqual(settled);
    });

    // Review 2 of issue 2917: a visitor drilling a lost diver takes a mark
    // back or sets one to not boarded. Only a standing "boarded" is back.
    it("brings home a diver whose return mark was taken back or set to not boarded", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const anHourLater = new Date(boat.endsAt.getTime() + 60 * 60_000);
      const back = await db
        .select()
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.tripId, boat.id),
            eq(rollCallEvents.checkpoint, "after_dive_2"),
            eq(rollCallEvents.status, "boarded"),
          ),
        )
        .orderBy(asc(rollCallEvents.occurredAt));
      const [first, second] = back;
      const last = back.at(-1);
      if (!first || !second || !last) throw new Error("expected divers counted back");
      const drill = (row: typeof first, status: "cleared" | "not_boarded") => ({
        shopId: row.shopId,
        tripId: row.tripId,
        bookingId: row.bookingId,
        recordedByPersonId: row.recordedByPersonId,
        checkpoint: "after_dive_2",
        status,
        source: "live" as const,
        occurredAt: new Date(last.occurredAt.getTime() + 1_000),
      });
      await db
        .insert(rollCallEvents)
        .values([drill(first, "cleared"), drill(second, "not_boarded")]);

      expect(await bringDemoBoatsAtSeaHome(db, anHourLater)).toBeGreaterThanOrEqual(1);

      const afterDiveTwo = await getTripManifest(db, shop.id, boat.id, "after_dive_2");
      expect(afterDiveTwo?.summary.awaiting).toBe(0);
      expect(afterDiveTwo?.summary.boarded).toBe(afterDiveTwo?.summary.totalDivers);
    });

    it("leaves a cancelled boat at sea alone", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, boat.id));
      const before = await marks(db, boat.id);

      await bringDemoBoatsAtSeaHome(db, new Date(boat.endsAt.getTime() + 60 * 60_000));

      expect(await marks(db, boat.id)).toEqual(before);
      const logged = await db
        .select({ id: executedDives.id })
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      expect(logged).toHaveLength(0);
    });

    it("counts every diver and both guides back after dive 2, and logs it, once she is past her return", async () => {
      const { db, shop } = historyCtx;
      const boat = await boatAtSea(db, shop.id);
      const later = new Date(boat.endsAt.getTime() + 5 * 60 * 60_000);

      await refreshCanonicalDemoSchedule(db, { now: later });

      const afterDiveTwo = await getTripManifest(db, shop.id, boat.id, "after_dive_2");
      expect(afterDiveTwo?.summary.awaiting).toBe(0);
      expect(afterDiveTwo?.summary.notBackAboard).toBe(0);
      expect(afterDiveTwo?.summary.boarded).toBe(afterDiveTwo?.summary.totalDivers);
      const crewBack = await db
        .select({ personId: rollCallCrewEvents.personId })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.tripId, boat.id),
            eq(rollCallCrewEvents.checkpoint, "after_dive_2"),
          ),
        );
      const crew = await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, boat.id));
      expect(new Set(crewBack.map((row) => row.personId))).toEqual(
        new Set(crew.map((row) => row.personId)),
      );
      const [diveTwo] = await db
        .select()
        .from(executedDives)
        .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)));
      expect(diveTwo?.exitedAt?.getTime()).toBeLessThanOrEqual(boat.endsAt.getTime());
      expect(diveTwo?.maxDepthMeters).toBeGreaterThan(0);
      for (const at of await marks(db, boat.id)) {
        expect(at).toBeLessThanOrEqual(boat.endsAt.getTime());
      }

      // A second pass finds her home and writes nothing.
      const settled = await marks(db, boat.id);
      await refreshCanonicalDemoSchedule(db, { now: later });
      expect(await marks(db, boat.id)).toEqual(settled);
    });
  });
});
