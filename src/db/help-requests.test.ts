import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { deleteDiver } from "./divers";
import {
  assignHelpRequestHelper,
  completeHelpRequest,
  getHelpRequestForBooking,
  listHandledHelpRequests,
  listTodayHelpRequests,
  saveHelpRequest,
  undoHelpRequestCompletion,
} from "./help-requests";
import { getReadyPageData } from "./ready";
import { bookings, people, personRoles, tripHelpRequests, trips, userAccounts } from "./schema";
import { removeStaffMember, setStaffRoles } from "./staff-accounts";
import {
  changeTripCrew,
  getTripCrewAssignments,
  getTripRoster,
  listStaff,
  setTripCrew,
  upcomingTripsWithCounts,
} from "./trips";

const ctx = fileScopedShopContext();

/** Give a staff actor the active sign-in account every write-time staff check requires. */
async function withActiveAccount(db: AppDb, personId: string): Promise<void> {
  const [account] = await db
    .update(userAccounts)
    .set({ status: "active" })
    .where(eq(userAccounts.personId, personId))
    .returning({ id: userAccounts.id });
  if (account) return;
  await db.insert(userAccounts).values({ personId, email: `${personId}@example.invalid` });
}

/** The helper's sign-in account, made active, with another owner kept so a removal is allowed. */
async function removableHelper(db: AppDb, helperId: string, actorId: string): Promise<string> {
  await withActiveAccount(db, helperId);
  await db.insert(personRoles).values({ personId: actorId, role: "owner" }).onConflictDoNothing();
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, helperId));
  if (!account) throw new Error("expected helper account");
  return account.id;
}

async function setAccountStatus(
  db: AppDb,
  personId: string,
  status: "active" | "disabled",
): Promise<void> {
  await db.update(userAccounts).set({ status }).where(eq(userAccounts.personId, personId));
}

/** A request on the seeded reef trip, with rostered crew and an active staff actor at hand. */
async function requestedHelp(db: AppDb, shopId: string) {
  const trip = (await upcomingTripsWithCounts(db, shopId)).find(
    (row) => row.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  const [seat] = await getTripRoster(db, shopId, trip.id);
  const assignments = await getTripCrewAssignments(db, shopId, trip.id);
  const staff = await listStaff(db, shopId);
  const helper = staff.find((row) =>
    assignments.some((assignment) => assignment.personId === row.person.id),
  );
  const actor = staff.find((row) => row.person.id !== helper?.person.id);
  if (!seat || !helper || !actor) throw new Error("expected seeded seat, crew and other staff");
  await withActiveAccount(db, actor.person.id);
  const now = new Date(trip.startsAt.getTime() - 60 * 60 * 1000);
  const saved = await saveHelpRequest(db, {
    shopId,
    bookingId: seat.booking.id,
    kind: "carry_gear",
    now,
  });
  if (!saved.ok || !saved.request) throw new Error("expected request to save");
  return { trip, seat, helper: helper.person, actor: actor.person, now, requested: saved.request };
}

/** The same request, assigned to the rostered crew member. */
async function assignedRequest(db: AppDb, shopId: string) {
  const setup = await requestedHelp(db, shopId);
  const assigned = await assignHelpRequestHelper(db, {
    shopId,
    requestId: setup.requested.id,
    expectedRevision: setup.requested.revision,
    helperPersonId: setup.helper.id,
    actorPersonId: setup.actor.id,
    expectedStatus: "requested",
    now: setup.now,
  });
  if (!assigned.ok) throw new Error("expected helper assignment");
  return { ...setup, assigned: assigned.request };
}

/** The same request, completed. */
async function handledRequest(db: AppDb, shopId: string) {
  const setup = await assignedRequest(db, shopId);
  const completed = await completeHelpRequest(db, {
    shopId,
    requestId: setup.assigned.id,
    expectedRevision: setup.assigned.revision,
    actorPersonId: setup.actor.id,
    expectedHelperPersonId: setup.helper.id,
    now: setup.now,
  });
  if (!completed.ok) throw new Error("expected completion");
  return { ...setup, handled: completed.request };
}

async function storedRequest(db: AppDb, requestId: string) {
  const [row] = await db.select().from(tripHelpRequests).where(eq(tripHelpRequests.id, requestId));
  return row;
}

describe("day-of help requests", () => {
  it("moves one request from diver choice to acknowledgment to handled", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("expected seeded trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const crewAssignments = await getTripCrewAssignments(db, shop.id, trip.id);
    const staff = await listStaff(db, shop.id);
    const helper = staff.find((row) =>
      crewAssignments.some((assignment) => assignment.personId === row.person.id),
    );
    const actor = staff.find((row) => row.person.id !== helper?.person.id) ?? helper;
    if (!seat || !helper || !actor) throw new Error("expected seeded seat and assigned staff");
    await withActiveAccount(db, actor.person.id);
    const now = new Date(trip.startsAt.getTime() - 60 * 60 * 1000);

    const saved = await saveHelpRequest(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      kind: "carry_gear",
      now,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok || !saved.request) throw new Error("expected request to save");
    expect(saved.request.status).toBe("requested");

    expect(await listTodayHelpRequests(db, shop.id, [trip.id], now)).toMatchObject([
      {
        id: saved.request.id,
        bookingId: seat.booking.id,
        kind: "carry_gear",
        status: "requested",
        personName: seat.person.fullName,
      },
    ]);

    const handledTooSoon = await completeHelpRequest(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: saved.request.revision,
      actorPersonId: actor.person.id,
      expectedHelperPersonId: helper.person.id,
      now,
    });
    expect(handledTooSoon).toEqual({ ok: false, reason: "invalid_transition" });

    const acknowledged = await assignHelpRequestHelper(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: saved.request.revision,
      helperPersonId: helper.person.id,
      actorPersonId: actor.person.id,
      expectedStatus: "requested",
      now,
    });
    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) throw new Error("expected acknowledgment to save");
    expect(acknowledged.request.acknowledgedAt).toEqual(now);
    expect(acknowledged.request.helperPersonId).toBe(helper.person.id);
    const assignedRows = await listTodayHelpRequests(db, shop.id, [trip.id], now);
    expect(assignedRows).toHaveLength(1);
    expect(assignedRows[0]).toMatchObject({
      id: saved.request.id,
      status: "acknowledged",
      helperPersonId: helper.person.id,
      helperPersonName: helper.person.fullName,
      crew: expect.arrayContaining([
        { personId: helper.person.id, fullName: helper.person.fullName },
      ]),
    });
    const ready = await getReadyPageData(db, seat.booking.id, now);
    expect(ready?.helpRequest).toMatchObject({
      status: "acknowledged",
      helperPersonName: helper.person.fullName,
    });

    const handled = await completeHelpRequest(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: acknowledged.request.revision,
      actorPersonId: actor.person.id,
      expectedHelperPersonId: helper.person.id,
      now,
    });
    expect(handled.ok).toBe(true);
    if (!handled.ok) throw new Error("expected handled request to save");
    expect(handled.request.status).toBe("handled");
    expect(handled.request.handledAt).toEqual(now);
    expect(handled.request.helperPersonId).toBe(helper.person.id);
    expect(await listTodayHelpRequests(db, shop.id, [trip.id], now)).toEqual([]);
    expect((await getHelpRequestForBooking(db, shop.id, seat.booking.id, now))?.status).toBe(
      "handled",
    );

    expect(
      await saveHelpRequest(db, {
        shopId: shop.id,
        bookingId: seat.booking.id,
        kind: "none",
        now,
      }),
    ).toEqual({ ok: false, reason: "handled" });
  });

  it("records a named crew helper, completes the request, and safely undoes completion", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("expected seeded trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const assignments = await getTripCrewAssignments(db, shop.id, trip.id);
    const staff = await listStaff(db, shop.id);
    const crew = staff.find((row) =>
      assignments.some((assignment) => assignment.personId === row.person.id),
    );
    const actor = staff.find((row) => row.person.id !== crew?.person.id) ?? crew;
    if (!seat || !crew || !actor) throw new Error("expected seeded seat and assigned staff");
    await withActiveAccount(db, actor.person.id);
    const now = new Date(trip.startsAt.getTime() - 60 * 60 * 1000);
    const saved = await saveHelpRequest(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      kind: "first_timer",
      now,
    });
    if (!saved.ok || !saved.request) throw new Error("expected request to save");

    const assigned = await assignHelpRequestHelper(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: saved.request.revision,
      helperPersonId: crew.person.id,
      actorPersonId: actor.person.id,
      expectedStatus: "requested",
      now,
    });
    expect(assigned).toMatchObject({
      ok: true,
      request: { status: "acknowledged", helperPersonId: crew.person.id },
    });
    if (!assigned.ok) throw new Error("expected helper to be assigned");

    expect(
      await assignHelpRequestHelper(db, {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        helperPersonId: crew.person.id,
        actorPersonId: actor.person.id,
        expectedStatus: "requested",
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });

    const completed = await completeHelpRequest(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: assigned.request.revision,
      actorPersonId: actor.person.id,
      expectedHelperPersonId: crew.person.id,
      now,
    });
    expect(completed).toMatchObject({
      ok: true,
      request: { status: "handled", helperPersonId: crew.person.id, handledAt: now },
    });
    expect(await listTodayHelpRequests(db, shop.id, [trip.id], now)).toEqual([]);

    const undone = await undoHelpRequestCompletion(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: completed.ok ? completed.request.revision : -1,
      actorPersonId: actor.person.id,
      expectedHelperPersonId: crew.person.id,
      now: new Date(now.getTime() + 1_000),
    });
    expect(undone).toMatchObject({
      ok: true,
      request: { status: "acknowledged", helperPersonId: crew.person.id, handledAt: null },
    });
    expect(await listTodayHelpRequests(db, shop.id, [trip.id], now)).toHaveLength(1);
    expect(
      await undoHelpRequestCompletion(db, {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        actorPersonId: actor.person.id,
        expectedHelperPersonId: crew.person.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("rejects a helper who is not assigned to the departure and a stale helper choice", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("expected seeded trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const assignments = await getTripCrewAssignments(db, shop.id, trip.id);
    const staff = await listStaff(db, shop.id);
    const nonCrew = staff.find(
      (row) => !assignments.some((assignment) => assignment.personId === row.person.id),
    );
    const crew = staff.find((row) =>
      assignments.some((assignment) => assignment.personId === row.person.id),
    );
    if (!seat || !crew || !nonCrew) throw new Error("expected seeded crew and non-crew staff");
    await withActiveAccount(db, crew.person.id);
    const saved = await saveHelpRequest(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      kind: "carry_gear",
    });
    if (!saved.ok || !saved.request) throw new Error("expected request to save");

    expect(
      await assignHelpRequestHelper(db, {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        helperPersonId: nonCrew.person.id,
        actorPersonId: crew.person.id,
        expectedStatus: "requested",
      }),
    ).toEqual({ ok: false, reason: "invalid_helper" });
    expect(
      await assignHelpRequestHelper(db, {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        helperPersonId: crew.person.id,
        actorPersonId: crew.person.id,
        expectedStatus: "acknowledged",
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("clears an acknowledged helper when crew changes remove them from the departure", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("expected seeded trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const crewAssignments = await getTripCrewAssignments(db, shop.id, trip.id);
    const staff = await listStaff(db, shop.id);
    const helper = staff.find((row) =>
      crewAssignments.some((assignment) => assignment.personId === row.person.id),
    );
    const actor = staff.find((row) => row.person.id !== helper?.person.id) ?? helper;
    if (!seat || !helper || !actor) throw new Error("expected seeded seat and assigned staff");
    await withActiveAccount(db, actor.person.id);

    const saved = await saveHelpRequest(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      kind: "carry_gear",
    });
    if (!saved.ok || !saved.request) throw new Error("expected request to save");
    const assigned = await assignHelpRequestHelper(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: saved.request.revision,
      helperPersonId: helper.person.id,
      actorPersonId: actor.person.id,
      expectedStatus: "requested",
    });
    if (!assigned.ok) throw new Error("expected helper assignment");
    expect((await getReadyPageData(db, seat.booking.id))?.helpRequest?.helperPersonName).toBe(
      helper.person.fullName,
    );

    expect(
      await changeTripCrew(db, shop.id, trip.id, {
        personId: helper.person.id,
        operation: "unassign",
      }),
    ).toBe(true);
    expect((await getReadyPageData(db, seat.booking.id))?.helpRequest).toMatchObject({
      status: "requested",
      helperPersonId: null,
      helperPersonName: null,
    });

    expect(
      await changeTripCrew(db, shop.id, trip.id, {
        personId: helper.person.id,
        operation: "assign",
      }),
    ).toBe(true);
    const reassigned = await assignHelpRequestHelper(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision:
        (await getHelpRequestForBooking(db, shop.id, seat.booking.id))?.revision ?? -1,
      helperPersonId: helper.person.id,
      actorPersonId: actor.person.id,
      expectedStatus: "requested",
    });
    expect(reassigned.ok).toBe(true);
    if (!reassigned.ok) throw new Error("expected helper reassignment");
    const completed = await completeHelpRequest(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      expectedRevision: reassigned.request.revision,
      actorPersonId: actor.person.id,
      expectedHelperPersonId: helper.person.id,
    });
    expect(completed.ok).toBe(true);
    expect(await setTripCrew(db, shop.id, trip.id, [])).toBe(true);
    // Handled keeps who helped; only an acknowledged promise goes back to the desk.
    expect((await getReadyPageData(db, seat.booking.id))?.helpRequest).toMatchObject({
      status: "handled",
      helperPersonId: helper.person.id,
    });
    expect(
      await undoHelpRequestCompletion(db, {
        shopId: shop.id,
        requestId: saved.request.id,
        expectedRevision: saved.request.revision,
        actorPersonId: actor.person.id,
        expectedHelperPersonId: helper.person.id,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
  });
  it("refuses a disabled staff account at assign, complete and undo, and writes nothing", async () => {
    const { db, shop } = ctx;
    const { requested, helper, actor, now } = await requestedHelp(db, shop.id);
    // Access revoked, role row intact: the "they left, keep the history" shape.
    await setAccountStatus(db, actor.id, "disabled");
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, actor.id)),
    ).not.toEqual([]);
    const assignInput = {
      shopId: shop.id,
      requestId: requested.id,
      expectedRevision: requested.revision,
      helperPersonId: helper.id,
      actorPersonId: actor.id,
      expectedStatus: "requested" as const,
      now,
    };
    expect(await assignHelpRequestHelper(db, assignInput)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await storedRequest(db, requested.id)).toMatchObject({
      status: "requested",
      helperPersonId: null,
      revision: requested.revision,
    });

    await setAccountStatus(db, actor.id, "active");
    const assigned = await assignHelpRequestHelper(db, assignInput);
    if (!assigned.ok) throw new Error("expected an active account to assign");
    const completeInput = {
      shopId: shop.id,
      requestId: requested.id,
      expectedRevision: assigned.request.revision,
      actorPersonId: actor.id,
      expectedHelperPersonId: helper.id,
      now,
    };
    await setAccountStatus(db, actor.id, "disabled");
    expect(await completeHelpRequest(db, completeInput)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await storedRequest(db, requested.id)).toMatchObject({
      status: "acknowledged",
      revision: assigned.request.revision,
    });

    await setAccountStatus(db, actor.id, "active");
    const completed = await completeHelpRequest(db, completeInput);
    if (!completed.ok) throw new Error("expected an active account to complete");
    await setAccountStatus(db, actor.id, "disabled");
    expect(
      await undoHelpRequestCompletion(db, {
        ...completeInput,
        expectedRevision: completed.request.revision,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await storedRequest(db, requested.id)).toMatchObject({
      status: "handled",
      revision: completed.request.revision,
    });
  });

  it("refuses an invited account that never activated", async () => {
    const { db, shop } = ctx;
    const { requested, helper, actor, now } = await requestedHelp(db, shop.id);
    await db
      .update(userAccounts)
      .set({ status: "invited" })
      .where(eq(userAccounts.personId, actor.id));
    expect(
      await assignHelpRequestHelper(db, {
        shopId: shop.id,
        requestId: requested.id,
        expectedRevision: requested.revision,
        helperPersonId: helper.id,
        actorPersonId: actor.id,
        expectedStatus: "requested",
        now,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("refuses a staff role with no sign-in account at all", async () => {
    const { db, shop } = ctx;
    const { requested, helper, now } = await requestedHelp(db, shop.id);
    const [ghost] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Roleless Account" })
      .returning();
    if (!ghost) throw new Error("person insert failed");
    await db.insert(personRoles).values({ personId: ghost.id, role: "owner" });
    expect(
      await assignHelpRequestHelper(db, {
        shopId: shop.id,
        requestId: requested.id,
        expectedRevision: requested.revision,
        helperPersonId: helper.id,
        actorPersonId: ghost.id,
        expectedStatus: "requested",
        now,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("keeps who helped on a handled request when that helper later leaves the crew", async () => {
    const { db, shop } = ctx;
    const { trip, helper, handled } = await handledRequest(db, shop.id);
    expect(
      await changeTripCrew(db, shop.id, trip.id, { personId: helper.id, operation: "unassign" }),
    ).toBe(true);
    expect(await storedRequest(db, handled.id)).toMatchObject({
      status: "handled",
      helperPersonId: helper.id,
      revision: handled.revision,
    });
    expect(await setTripCrew(db, shop.id, trip.id, [])).toBe(true);
    expect(await storedRequest(db, handled.id)).toMatchObject({
      status: "handled",
      helperPersonId: helper.id,
      revision: handled.revision,
    });
  });

  describe("a helper who stops being live staff", () => {
    async function expectBackAtTheDesk(
      db: AppDb,
      shopId: string,
      setup: Awaited<ReturnType<typeof assignedRequest>>,
    ) {
      expect(await storedRequest(db, setup.assigned.id)).toMatchObject({
        status: "requested",
        helperPersonId: null,
        acknowledgedAt: null,
      });
      expect(await listTodayHelpRequests(db, shopId, [setup.trip.id], setup.now)).toMatchObject([
        { id: setup.assigned.id, status: "requested", helperPersonName: null },
      ]);
      expect(
        (await getHelpRequestForBooking(db, shopId, setup.seat.booking.id, setup.now))
          ?.helperPersonName,
      ).toBeNull();
    }

    it("returns the request to the desk when the helper is removed from the team", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      const userAccountId = await removableHelper(db, setup.helper.id, setup.actor.id);
      expect(
        await removeStaffMember(db, { shopId: shop.id, personId: setup.helper.id, userAccountId }),
      ).toEqual({ ok: true });
      await expectBackAtTheDesk(db, shop.id, setup);
    });

    it("returns the request to the desk when every staff role is taken away", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      await removableHelper(db, setup.helper.id, setup.actor.id);
      expect(
        await setStaffRoles(db, { shopId: shop.id, personId: setup.helper.id, roles: [] }),
      ).toEqual({ ok: true });
      await expectBackAtTheDesk(db, shop.id, setup);
    });

    it("keeps the helper when a role change still leaves them staff", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      await removableHelper(db, setup.helper.id, setup.actor.id);
      expect(
        await setStaffRoles(db, { shopId: shop.id, personId: setup.helper.id, roles: ["crew"] }),
      ).toEqual({ ok: true });
      expect(await storedRequest(db, setup.assigned.id)).toMatchObject({
        status: "acknowledged",
        helperPersonId: setup.helper.id,
      });
    });

    it("returns the request to the desk when the helper is deleted", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      expect(await deleteDiver(db, shop.id, setup.helper.id)).toBe(true);
      await expectBackAtTheDesk(db, shop.id, setup);
    });

    it("leaves a request on a departure that has already ended", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      const [row] = await db
        .select({ endsAt: trips.endsAt })
        .from(trips)
        .where(eq(trips.id, setup.trip.id));
      if (!row) throw new Error("trip missing");
      vi.stubEnv("DIVEDAY_CLOCK", new Date(row.endsAt.getTime() + 1).toISOString());
      expect(await deleteDiver(db, shop.id, setup.helper.id)).toBe(true);
      vi.unstubAllEnvs();
      expect(await storedRequest(db, setup.assigned.id)).toMatchObject({
        status: "acknowledged",
        helperPersonId: setup.helper.id,
      });
    });

    it("names nobody, on Today or the diver page, once the helper lost their roles some other way", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      await db.delete(personRoles).where(eq(personRoles.personId, setup.helper.id));
      expect(await listTodayHelpRequests(db, shop.id, [setup.trip.id], setup.now)).toMatchObject([
        { id: setup.assigned.id, helperPersonName: null },
      ]);
      expect(
        (await getHelpRequestForBooking(db, shop.id, setup.seat.booking.id, setup.now))
          ?.helperPersonName,
      ).toBeNull();
    });

    it("refuses to complete a request whose helper is no longer eligible", async () => {
      const { db, shop } = ctx;
      const setup = await assignedRequest(db, shop.id);
      await db.delete(personRoles).where(eq(personRoles.personId, setup.helper.id));
      expect(
        await completeHelpRequest(db, {
          shopId: shop.id,
          requestId: setup.assigned.id,
          expectedRevision: setup.assigned.revision,
          actorPersonId: setup.actor.id,
          expectedHelperPersonId: setup.helper.id,
          now: setup.now,
        }),
      ).toEqual({ ok: false, reason: "invalid_helper" });
      expect((await storedRequest(db, setup.assigned.id))?.status).toBe("acknowledged");
    });
  });

  describe("undoing a completion", () => {
    async function undo(
      db: AppDb,
      shopId: string,
      setup: Awaited<ReturnType<typeof handledRequest>>,
      now = setup.now,
    ) {
      return undoHelpRequestCompletion(db, {
        shopId,
        requestId: setup.handled.id,
        expectedRevision: setup.handled.revision,
        actorPersonId: setup.actor.id,
        expectedHelperPersonId: setup.helper.id,
        now,
      });
    }

    it("refuses on a cancelled departure", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, setup.trip.id));
      expect(await undo(db, shop.id, setup)).toEqual({ ok: false, reason: "invalid_transition" });
      expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
    });

    it("refuses once the departure has ended", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      const [row] = await db
        .select({ endsAt: trips.endsAt })
        .from(trips)
        .where(eq(trips.id, setup.trip.id));
      if (!row) throw new Error("trip missing");
      expect(await undo(db, shop.id, setup, new Date(row.endsAt.getTime() + 1))).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
    });

    it("refuses on a cancelled booking", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      await db
        .update(bookings)
        .set({ status: "cancelled" })
        .where(eq(bookings.id, setup.seat.booking.id));
      expect(await undo(db, shop.id, setup)).toEqual({ ok: false, reason: "invalid_transition" });
      expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
    });

    async function expectReopened(
      db: AppDb,
      shopId: string,
      setup: Awaited<ReturnType<typeof handledRequest>>,
    ) {
      expect(await undo(db, shopId, setup)).toMatchObject({
        ok: true,
        request: { status: "requested", helperPersonId: null, handledAt: null },
      });
      expect(await storedRequest(db, setup.handled.id)).toMatchObject({
        status: "requested",
        helperPersonId: null,
        acknowledgedAt: null,
        handledAt: null,
      });
      expect(await listTodayHelpRequests(db, shopId, [setup.trip.id], setup.now)).toMatchObject([
        { id: setup.handled.id, status: "requested", helperPersonName: null },
      ]);
    }

    it("reopens the request for the desk when the recorded helper is off the crew", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      expect(
        await changeTripCrew(db, shop.id, setup.trip.id, {
          personId: setup.helper.id,
          operation: "unassign",
        }),
      ).toBe(true);
      await expectReopened(db, shop.id, setup);
    });

    it("reopens the request for the desk when the recorded helper lost every staff role", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      await db.delete(personRoles).where(eq(personRoles.personId, setup.helper.id));
      await expectReopened(db, shop.id, setup);
    });

    it("reopens the request for the desk when the recorded helper was deleted", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      await db.update(people).set({ deletedAt: setup.now }).where(eq(people.id, setup.helper.id));
      await expectReopened(db, shop.id, setup);
    });

    it("still refuses a stale revision, even with the helper gone", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      await db.delete(personRoles).where(eq(personRoles.personId, setup.helper.id));
      expect(
        await undoHelpRequestCompletion(db, {
          shopId: shop.id,
          requestId: setup.handled.id,
          expectedRevision: setup.handled.revision - 1,
          actorPersonId: setup.actor.id,
          expectedHelperPersonId: setup.helper.id,
          now: setup.now,
        }),
      ).toEqual({ ok: false, reason: "invalid_transition" });
      expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
    });

    it("still refuses a cancelled booking when the helper is gone too", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      await db.delete(personRoles).where(eq(personRoles.personId, setup.helper.id));
      await db
        .update(bookings)
        .set({ status: "cancelled" })
        .where(eq(bookings.id, setup.seat.booking.id));
      expect(await undo(db, shop.id, setup)).toEqual({ ok: false, reason: "invalid_transition" });
      expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
    });

    it("restores the assigned state while every guard still holds", async () => {
      const { db, shop } = ctx;
      const setup = await handledRequest(db, shop.id);
      expect(await undo(db, shop.id, setup)).toMatchObject({
        ok: true,
        request: { status: "acknowledged", helperPersonId: setup.helper.id, handledAt: null },
      });
    });
  });
});

describe("handled help requests on a departure", () => {
  it("lists a handled request with the helper who is recorded, and drops it once reopened", async () => {
    const { db, shop } = ctx;
    const setup = await handledRequest(db, shop.id);
    const listed = await listHandledHelpRequests(db, shop.id, [setup.trip.id], setup.now);
    expect(listed).toEqual([
      expect.objectContaining({
        id: setup.handled.id,
        tripId: setup.trip.id,
        revision: setup.handled.revision,
        kind: "carry_gear",
        helperPersonId: setup.helper.id,
        helperPersonName: setup.helper.fullName,
      }),
    ]);
    // The Today list never carries it.
    expect(await listTodayHelpRequests(db, shop.id, [setup.trip.id], setup.now)).toEqual([]);

    const reopened = await undoHelpRequestCompletion(db, {
      shopId: shop.id,
      requestId: setup.handled.id,
      expectedRevision: setup.handled.revision,
      actorPersonId: setup.actor.id,
      expectedHelperPersonId: setup.helper.id,
      now: setup.now,
    });
    expect(reopened).toMatchObject({ ok: true, request: { status: "acknowledged" } });
    expect(await listHandledHelpRequests(db, shop.id, [setup.trip.id], setup.now)).toEqual([]);
  });

  it("lists nothing for a finished departure, another shop's trip or no trips", async () => {
    const { db, shop } = ctx;
    const setup = await handledRequest(db, shop.id);
    expect(await listHandledHelpRequests(db, shop.id, [], setup.now)).toEqual([]);
    const after = new Date(setup.trip.endsAt.getTime() + 1);
    expect(await listHandledHelpRequests(db, shop.id, [setup.trip.id], after)).toEqual([]);
    expect(
      await listHandledHelpRequests(
        db,
        "00000000-0000-4000-8000-000000000000",
        [setup.trip.id],
        setup.now,
      ),
    ).toEqual([]);
  });

  it("refuses a reopen from someone who is not staff, and leaves the request handled", async () => {
    const { db, shop } = ctx;
    const setup = await handledRequest(db, shop.id);
    expect(
      await undoHelpRequestCompletion(db, {
        shopId: shop.id,
        requestId: setup.handled.id,
        expectedRevision: setup.handled.revision,
        actorPersonId: setup.seat.booking.personId,
        expectedHelperPersonId: setup.helper.id,
        now: setup.now,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
  });

  it("refuses a reopen that names another shop, and leaves the request handled", async () => {
    const { db, shop } = ctx;
    const setup = await handledRequest(db, shop.id);
    expect(
      await undoHelpRequestCompletion(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        requestId: setup.handled.id,
        expectedRevision: setup.handled.revision,
        actorPersonId: setup.actor.id,
        expectedHelperPersonId: setup.helper.id,
        now: setup.now,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
    expect((await storedRequest(db, setup.handled.id))?.status).toBe("handled");
  });
});
