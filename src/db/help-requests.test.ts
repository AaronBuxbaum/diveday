import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  assignHelpRequestHelper,
  completeHelpRequest,
  getHelpRequestForBooking,
  listTodayHelpRequests,
  saveHelpRequest,
  undoHelpRequestCompletion,
} from "./help-requests";
import { getReadyPageData } from "./ready";
import {
  changeTripCrew,
  getTripCrewAssignments,
  getTripRoster,
  listStaff,
  setTripCrew,
  upcomingTripsWithCounts,
} from "./trips";

const ctx = fileScopedShopContext();

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

  it("clears a confirmed helper when crew changes remove them from the departure", async () => {
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
    expect((await getReadyPageData(db, seat.booking.id))?.helpRequest).toMatchObject({
      status: "handled",
      helperPersonId: null,
      helperPersonName: null,
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
});
