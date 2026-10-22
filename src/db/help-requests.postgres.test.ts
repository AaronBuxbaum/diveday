import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop, withinOrParked } from "@/test/postgres-shop";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { assignHelpRequestHelper, saveHelpRequest } from "./help-requests";
import { people, personRoles, tripAssignments, tripHelpRequests, trips } from "./schema";
import { setTripCrew } from "./trips";

/** A statement trigger parks removal after request cleanup but before assignment tuple locks. */
const removalGate = sql`select pg_advisory_xact_lock(2851)`;

async function requestedHelp(db: AppDb) {
  const shop = await raceShop(db, "Help race");
  const now = nowDate();
  const [helper] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Confirmed Crew" })
    .returning();
  if (!helper) throw new Error("helper insert failed");
  await db.insert(personRoles).values({ personId: helper.id, role: "crew" });
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Helper race charter",
      startsAt: new Date(now.getTime() + HOUR_MS),
      endsAt: new Date(now.getTime() + 4 * HOUR_MS),
      capacity: 4,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: helper.id });
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Asking Diver",
    email: "asking@example.invalid",
  });
  if (!booking.ok) throw new Error(`booking refused: ${booking.reason}`);
  const saved = await saveHelpRequest(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    kind: "carry_gear",
    now,
  });
  if (!saved.ok || !saved.request) throw new Error("request not saved");
  return { shop, helper, trip, booking, saved: { ...saved, request: saved.request }, now };
}

describePostgres("named help assignment against a crew removal", () => {
  it("never keeps a named helper whose crew removal passed cleanup before the assignment", async () => {
    const pg = await postgresTestDb();
    const { shop, helper, trip, saved, now } = await requestedHelp(pg.db);
    await pg.db.execute(sql`
      create function gate_crew_removal() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(2851);
        return null;
      end;
      $$
    `);
    await pg.db.execute(sql`
      create trigger gate_crew_removal before delete on trip_assignments
      for each statement execute function gate_crew_removal()
    `);
    const gate = await holdRowLock(pg, removalGate);
    const removing = setTripCrew(pg.connect(), shop.id, trip.id, [], { now });
    let assigning: ReturnType<typeof assignHelpRequestHelper> | undefined;
    try {
      // This blocker is after the cleanup UPDATEs, which saw no named helper.
      await waitForLockWaiters(pg.db, 1);
      assigning = assignHelpRequestHelper(pg.connect(), {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        helperPersonId: helper.id,
        actorPersonId: helper.id,
        expectedStatus: "requested",
        now,
      });
      // Old code commits here. Correct trip-first locking waits for removal;
      // bound that observation, then release both paths before assertions.
      await withinOrParked(assigning);
    } finally {
      await gate.release();
    }
    expect(await removing).toBe(true);
    if (!assigning) throw new Error("assignment was not started");
    await assigning;
    expect(
      await pg.db.select().from(tripAssignments).where(eq(tripAssignments.tripId, trip.id)),
    ).toEqual([]);
    const [after] = await pg.db
      .select()
      .from(tripHelpRequests)
      .where(eq(tripHelpRequests.id, saved.request.id));
    expect(after).toMatchObject({ status: "requested", helperPersonId: null });
  });
});

describePostgres("diver request edits against named helper assignment", () => {
  it("never deadlocks when an edit reaches its desk-event insert while assignment waits", async () => {
    const pg = await postgresTestDb();
    const { shop, helper, booking, saved, now } = await requestedHelp(pg.db);
    await pg.db.execute(sql`
      create function gate_help_edit() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(2852);
        return null;
      end;
      $$
    `);
    await pg.db.execute(sql`
      create trigger gate_help_edit before update on trip_help_requests
      for each statement execute function gate_help_edit()
    `);
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(2852)`);
    const editing = saveHelpRequest(pg.connect(), {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "first_timer",
      now,
    });
    let assigning: ReturnType<typeof assignHelpRequestHelper> | undefined;
    // Observe rejections immediately; the assertion after release decides whether either writer failed.
    const edited = editing.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await waitForLockWaiters(pg.db, 1);
      assigning = assignHelpRequestHelper(pg.connect(), {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        helperPersonId: helper.id,
        actorPersonId: helper.id,
        expectedStatus: "requested",
        now,
      });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    if (!assigning) throw new Error("assignment was not started");
    const assigned = assigning.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const outcomes = await Promise.all([edited, assigned]);
    const errors = outcomes.flatMap((outcome) => {
      if (!("error" in outcome)) return [];
      const error = outcome.error;
      return [
        error instanceof Error &&
        error.cause &&
        typeof error.cause === "object" &&
        "code" in error.cause
          ? String(error.cause.code)
          : String(error),
      ];
    });
    expect(errors).toEqual([]);
  });
});
