import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  addIncidentAddendum,
  fileIncidentReport,
  getIncidentReport,
  markMissingDiverFound,
  markMissingSubjectFound,
  openMissingAlerts,
  raiseMissingDiverAlert,
  saveIncidentDraft,
  startIncidentReport,
} from "./incident-reports";
import { complete, OTHER_SHOP, OTHER_TRIP } from "./incident-reports-test-fixtures";
import { sendMissingDiverAlerts, sendMissingDiverAllClear } from "./missing-diver-alerts";
import {
  MARKED_AT,
  mark,
  missingSeat,
  recorder,
  secondSeat,
  stateOf,
} from "./missing-diver-test-fixtures";
import { activityEvents, incidentReports, rollCallEvents, tripAssignments } from "./schema";

// The boat's followers are pushed by the alert; counted here, never sent.
const push = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./push-subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./push-subscriptions")>();
  return {
    ...actual,
    pushTripAlert: async () => {
      push.calls += 1;
      return 0;
    },
  };
});

afterEach(() => {
  push.calls = 0;
});

/**
 * **Found: one quiet all-clear** (issue #2694; domain and security reviews
 * 2026-10-17). One wrong tap must not silence a live disappearance, so Found
 * is refused while the roll call still has the person not back aboard; any
 * of the departure's crew may tap it once they are back, and the all-clear
 * goes at most once, honest about whether it reached every owner.
 */
const ctx = fileScopedShopContext();

const backAt = new Date(MARKED_AT.getTime() + 60_000);

/** A raised alert on the fixture's seat, the seat then marked back aboard. */
async function raisedThenBack() {
  const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
  const result = await raiseMissingDiverAlert(db, {
    ...input,
    actorPersonId: f.crew.id,
    provider: recorder().provider,
  });
  if (!result.ok || !result.reportId) throw new Error("raise refused");
  await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
  const target = { shopId: input.shopId, tripId: input.tripId, reportId: result.reportId };
  return { db, f, input, target, reportId: result.reportId };
}

describe("Found (issue #2694, in-memory PGlite)", () => {
  it("is refused while the roll call still has the diver not back aboard", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    const result = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: recorder().provider,
    });
    if (!result.ok || !result.reportId) throw new Error("raise refused");
    const { provider, sent } = recorder();
    expect(
      await markMissingDiverFound(db, {
        ...input,
        reportId: result.reportId,
        actorPersonId: f.owner.id,
        provider,
      }),
    ).toEqual({ ok: false, reason: "still_missing" });
    expect(
      await markMissingSubjectFound(db, { ...input, actorPersonId: f.crew.id, provider }),
    ).toEqual({ ok: false, reason: "still_missing" });
    expect(sent).toEqual([]);
    expect((await stateOf(db, result.reportId)).foundAt).toBeNull();
  });

  it("emails each owner once, pushes nobody, and records who found them", async () => {
    const { db, f, target, reportId } = await raisedThenBack();
    const pushedByAlert = push.calls;
    const { provider, sent, kinds } = recorder();
    expect(
      await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id, provider }),
    ).toEqual({
      ok: true,
      changed: true,
      allClear: "sent",
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(kinds("incident_missing_diver_found")).toBe(sent.length);
    expect(sent[0]).toMatchObject({ stillMissing: 0 });
    expect(push.calls).toBe(pushedByAlert);
    const state = await stateOf(db, reportId);
    expect(state.foundBy).toBe(f.crew.id);
    expect(state.allClearAt).toBeInstanceOf(Date);
    const view = await getIncidentReport(db, target.shopId, reportId, f.owner.id);
    expect(view?.ownersAlert).toMatchObject({
      foundByName: f.crew.fullName,
      allClear: { state: "sent" },
    });
    const codes = (await db.select({ code: activityEvents.code }).from(activityEvents))
      .map((row) => row.code)
      .filter((code) => code.startsWith("missing_diver_"));
    expect(codes).toEqual(["missing_diver_alert_raised", "missing_diver_found"]);
  });

  it("lets any of the departure's crew tap Found from the row, and nobody else", async () => {
    const { db, f, input, reportId } = await raisedThenBack();
    const { provider } = recorder();
    // The captain, not aboard this departure: refused.
    expect(
      await markMissingSubjectFound(db, { ...input, actorPersonId: f.ashore.id, provider }),
    ).toEqual({ ok: false, reason: "not_found" });
    // Rostered on it, they may, though the report is the divemaster's.
    await db.insert(tripAssignments).values({ tripId: f.trip.id, personId: f.ashore.id });
    expect(
      await markMissingSubjectFound(db, { ...input, actorPersonId: f.ashore.id, provider }),
    ).toEqual({ ok: true, changed: true, allClear: "sent" });
    expect((await stateOf(db, reportId)).foundBy).toBe(f.ashore.id);
    expect(await openMissingAlerts(db, input.shopId, input.tripId)).toEqual([]);
  });

  it("sends the all-clear at most once: a second tap, and a retry, send nothing", async () => {
    const { db, f, target, reportId } = await raisedThenBack();
    const { provider, sent } = recorder();
    const a = await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id, provider });
    const b = await markMissingDiverFound(db, { ...target, actorPersonId: f.owner.id, provider });
    expect([a, b].filter((r) => r.ok && r.changed)).toHaveLength(1);
    const once = sent.length;
    expect(once).toBeGreaterThan(0);
    expect(await sendMissingDiverAllClear(db, { shopId: target.shopId, reportId, provider })).toBe(
      "skipped",
    );
    expect(sent.length).toBe(once);
  });

  it("says when the all-clear did not reach every owner, and never retries it", async () => {
    const { db, f, target, reportId } = await raisedThenBack();
    await markMissingDiverFound(db, {
      ...target,
      actorPersonId: f.crew.id,
      provider: recorder("failed").provider,
    });
    const state = await stateOf(db, reportId);
    expect(state.allClearClaimedAt).toBeInstanceOf(Date);
    expect(state.allClearAt).toBeNull();
    const view = await getIncidentReport(db, target.shopId, reportId, f.owner.id);
    expect(view?.ownersAlert?.allClear).toEqual({ state: "partial" });
  });

  it("claims nothing for another shop's caller", async () => {
    const { db, f, target, reportId } = await raisedThenBack();
    // Found, as by a write whose all-clear never ran.
    await db
      .update(incidentReports)
      .set({ missingFoundAt: backAt, missingFoundByPersonId: f.crew.id })
      .where(eq(incidentReports.id, reportId));
    const { provider, sent } = recorder();
    expect(await sendMissingDiverAllClear(db, { shopId: OTHER_SHOP, reportId, provider })).toBe(
      "skipped",
    );
    expect(sent).toEqual([]);
    expect((await stateOf(db, reportId)).allClearClaimedAt).toBeNull();
    expect(await sendMissingDiverAllClear(db, { shopId: target.shopId, reportId, provider })).toBe(
      "sent",
    );
  });

  it("counts the others still reported missing on the departure, naming nobody", async () => {
    const { db, f, input, target } = await raisedThenBack();
    const other = await secondSeat(db, f);
    await mark(db, ctx.shop.id, f, other, "not_boarded", MARKED_AT);
    const second = await raiseMissingDiverAlert(db, {
      ...input,
      subject: { kind: "diver", bookingId: other },
      actorPersonId: f.crew.id,
      provider: recorder().provider,
    });
    expect(second).toMatchObject({ ok: true });
    const { provider, sent } = recorder();
    await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id, provider });
    expect(sent.length).toBeGreaterThan(0);
    for (const notification of sent) expect(notification).toMatchObject({ stillMissing: 1 });
  });

  it("refuses a report never alerted, staff who may not, and another shop or departure", async () => {
    const { db, f, input, target, reportId } = await raisedThenBack();
    const { provider, sent } = recorder();
    const plain = await startIncidentReport(db, { ...input, actorPersonId: f.crew.id });
    if (!plain.ok) throw new Error("start refused");
    expect(
      await markMissingDiverFound(db, {
        ...target,
        reportId: plain.reportId,
        actorPersonId: f.crew.id,
        provider,
      }),
    ).toEqual({ ok: false, reason: "not_alerted" });
    expect(await markMissingDiverFound(db, { ...target, actorPersonId: f.ashore.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await markMissingDiverFound(db, { ...target, shopId: OTHER_SHOP, actorPersonId: f.owner.id }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await markMissingDiverFound(db, { ...target, tripId: OTHER_TRIP, actorPersonId: f.owner.id }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(sent).toEqual([]);
    expect((await stateOf(db, reportId)).foundAt).toBeNull();
  });

  it("still takes a later dated note on the filed report after the find", async () => {
    const { db, f, target } = await raisedThenBack();
    const writer = { ...target, actorPersonId: f.crew.id };
    await markMissingDiverFound(db, { ...writer, provider: recorder().provider });
    await saveIncidentDraft(db, { ...writer, fields: { ...complete, kind: "missing_diver" } });
    expect(await fileIncidentReport(db, { ...writer, provider: recorder().provider })).toEqual({
      ok: true,
    });
    expect(
      await addIncidentAddendum(db, { ...writer, body: "Found on the reef top, well." }),
    ).toEqual({ ok: true });
  });

  it("is not back aboard on an undo: a cleared mark leaves them missing, and the pass still sends", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    // The provider is down: the raise stands, nobody was told.
    const down = recorder("failed");
    const raised = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: down.provider,
    });
    if (!raised.ok || !raised.reportId) throw new Error("raise refused");
    expect((await stateOf(db, raised.reportId)).sentAt).toBeNull();
    await db.insert(rollCallEvents).values({
      shopId: input.shopId,
      tripId: input.tripId,
      bookingId: f.seat.booking.id,
      recordedByPersonId: f.crew.id,
      status: "cleared",
      checkpoint: "after_dive_1",
      source: "live",
      occurredAt: backAt,
    });
    const { provider, sent } = recorder();
    expect(
      await markMissingDiverFound(db, {
        ...input,
        reportId: raised.reportId,
        actorPersonId: f.owner.id,
        provider,
      }),
    ).toEqual({ ok: false, reason: "still_missing" });
    expect(sent).toEqual([]);
    await sendMissingDiverAlerts(db, {
      reportId: raised.reportId,
      origin: "https://example.test",
      provider,
    });
    expect(sent.length).toBeGreaterThan(0);
    expect((await stateOf(db, raised.reportId)).sentAt).toBeInstanceOf(Date);
  });

  it("sends no all-clear for an alarm that never went, and says so", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    const raised = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: recorder("failed").provider,
    });
    if (!raised.ok || !raised.reportId) throw new Error("raise refused");
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const { provider, sent } = recorder();
    expect(
      await markMissingDiverFound(db, {
        shopId: input.shopId,
        tripId: input.tripId,
        reportId: raised.reportId,
        actorPersonId: f.crew.id,
        provider,
      }),
    ).toEqual({ ok: true, changed: true, allClear: "skipped" });
    expect(sent).toEqual([]);
    expect((await stateOf(db, raised.reportId)).allClearAt).toBeNull();
    // A second tap stamps nothing and, with nobody owed, sends nothing.
    expect(
      await markMissingDiverFound(db, {
        shopId: input.shopId,
        tripId: input.tripId,
        reportId: raised.reportId,
        actorPersonId: f.crew.id,
        provider,
      }),
    ).toEqual({ ok: true, changed: false, allClear: "skipped" });
  });

  it("reports a partial all-clear as partial", async () => {
    const { db, f, target } = await raisedThenBack();
    expect(
      await markMissingDiverFound(db, {
        ...target,
        actorPersonId: f.crew.id,
        provider: recorder("failed").provider,
      }),
    ).toEqual({ ok: true, changed: true, allClear: "partial" });
  });

  it("pushes nobody once Found lands mid-send", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    const raised = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: recorder("failed").provider,
    });
    if (!raised.ok || !raised.reportId) throw new Error("raise refused");
    const before = push.calls;
    const { sent } = recorder();
    // Found lands while the first owner's email is going out.
    const provider = {
      async send(notification: (typeof sent)[number]) {
        sent.push(notification);
        await db
          .update(incidentReports)
          .set({ missingFoundAt: backAt, missingFoundByPersonId: f.crew.id })
          .where(eq(incidentReports.id, raised.reportId as string));
        return { status: "sent" as const, providerMessageId: "m" };
      },
    };
    await sendMissingDiverAlerts(db, {
      reportId: raised.reportId,
      origin: "https://example.test",
      provider,
    });
    expect(push.calls).toBe(before);
  });
});
