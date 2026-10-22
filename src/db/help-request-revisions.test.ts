import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  assignHelpRequestHelper,
  completeHelpRequest,
  getHelpRequestForBooking,
  saveHelpRequest,
  undoHelpRequestCompletion,
} from "./help-requests";
import { getTripCrewAssignments, getTripRoster, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
async function requestFixture() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("missing trip");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  const [helper] = await getTripCrewAssignments(db, shop.id, trip.id);
  if (!seat || !helper) throw new Error("missing seat or crew");
  const now = new Date(trip.startsAt.getTime() - 60 * 60 * 1000);
  const saved = await saveHelpRequest(db, {
    shopId: shop.id,
    bookingId: seat.booking.id,
    kind: "first_timer",
    now,
  });
  if (!saved.ok || !saved.request) throw new Error("save refused");
  const input = {
    shopId: shop.id,
    requestId: saved.request.id,
    actorPersonId: helper.personId,
    now,
  };
  const assign = (revision: number, expectedStatus: "requested" | "acknowledged" = "requested") =>
    assignHelpRequestHelper(db, {
      ...input,
      helperPersonId: helper.personId,
      expectedStatus,
      expectedRevision: revision,
    });
  const complete = (revision: number) =>
    completeHelpRequest(db, {
      ...input,
      expectedHelperPersonId: helper.personId,
      expectedRevision: revision,
    });
  return {
    db,
    shop,
    seat,
    saved: { ...saved, request: saved.request },
    input,
    helper,
    now,
    assign,
    complete,
  };
}

describe("help request generation guards", () => {
  it("refuses an old completion after the kind is replaced and the same helper agrees again", async () => {
    const f = await requestFixture();
    const original = await f.assign(f.saved.request.revision);
    if (!original.ok) throw new Error("assign refused");
    const replacement = await saveHelpRequest(f.db, {
      shopId: f.shop.id,
      bookingId: f.seat.booking.id,
      kind: "carry_gear",
      now: f.now,
    });
    if (!replacement.ok || !replacement.request) throw new Error("replacement refused");
    const assigned = await f.assign(replacement.request.revision);
    if (!assigned.ok) throw new Error("new assignment refused");
    expect(await f.complete(original.request.revision)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(await getHelpRequestForBooking(f.db, f.shop.id, f.seat.booking.id, f.now)).toMatchObject(
      { kind: "carry_gear", status: "acknowledged" },
    );
  });

  it("refuses a requested assignment form for the previous kind even at the same clock instant", async () => {
    const f = await requestFixture();
    await saveHelpRequest(f.db, {
      shopId: f.shop.id,
      bookingId: f.seat.booking.id,
      kind: "carry_gear",
      now: f.now,
    });
    expect(await f.assign(f.saved.request.revision)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("refuses a competing same-status reassignment after a fresh helper confirmation", async () => {
    const f = await requestFixture();
    const original = await f.assign(f.saved.request.revision);
    if (!original.ok) throw new Error("assign refused");
    const fresh = await f.assign(original.request.revision, "acknowledged");
    expect(fresh.ok).toBe(true);
    expect(await f.assign(original.request.revision, "acknowledged")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("refuses an older Undo after completion, undo and completion return to the same status/helper", async () => {
    const f = await requestFixture();
    const assigned = await f.assign(f.saved.request.revision);
    if (!assigned.ok) throw new Error("assign refused");
    const completed = await f.complete(assigned.request.revision);
    if (!completed.ok) throw new Error("complete refused");
    const undo = (revision: number) =>
      undoHelpRequestCompletion(f.db, {
        ...f.input,
        expectedHelperPersonId: f.helper.personId,
        expectedRevision: revision,
      });
    const restored = await undo(completed.request.revision);
    if (!restored.ok) throw new Error("undo refused");
    expect((await f.complete(restored.request.revision)).ok).toBe(true);
    expect(await undo(completed.request.revision)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });
});
