import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  addIncidentAddendum,
  discardIncidentDraft,
  fileIncidentReport,
  getIncidentReport,
  markMissingDiverFound,
  raiseMissingDiverAlert,
  saveIncidentDraft,
  startIncidentReport,
  startMissingDiverReport,
} from "./incident-reports";
import { complete, fixture, OTHER_SHOP, OTHER_TRIP } from "./incident-reports-test-fixtures";
import { sendMissingDiverAlerts, sendMissingDiverAllClear } from "./missing-diver-alerts";
import { activityEvents, incidentReports, rollCallEvents, shops } from "./schema";

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
 * **"Missing diver, alert owners now" and "Found"** (issue #2694, decided by
 * Aaron 2026-10-17). Safety-critical, so the failure paths lead: a double
 * tap, a tap synced late from an offline tablet, another shop's caller, a
 * diver already found, staff who may not write, a found before the alert
 * went, and a second all-clear.
 */
const ctx = fileScopedShopContext();

// Five minutes ago: a diver who may be missing now, so the alert pushes too.
const MARKED_AT = new Date(nowDate().getTime() - 5 * 60 * 1000);

function recorder() {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  const kinds = (kind: string) => sent.filter((n) => n.kind === kind).length;
  return { sent, provider, kinds };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A real (not demo) shop's departure with the fixture's seat marked not back aboard. */
async function missingSeat(source: "live" | "offline" = "live") {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const f = await fixture(db, shop.id);
  await db.insert(rollCallEvents).values({
    shopId: shop.id,
    tripId: f.trip.id,
    bookingId: f.seat.booking.id,
    recordedByPersonId: f.crew.id,
    status: "not_boarded",
    checkpoint: "after_dive_1",
    source,
    occurredAt: MARKED_AT,
  });
  const input = {
    shopId: shop.id,
    tripId: f.trip.id,
    subject: { kind: "diver" as const, bookingId: f.seat.booking.id },
  };
  return { db, f, input };
}

async function stateOf(db: AppDb, reportId: string) {
  const [row] = await db
    .select({
      kind: incidentReports.kind,
      status: incidentReports.status,
      raisedAt: incidentReports.missingAlertRaisedAt,
      raisedBy: incidentReports.missingAlertRaisedByPersonId,
      sentAt: incidentReports.missingAlertSentAt,
      foundAt: incidentReports.missingFoundAt,
      foundBy: incidentReports.missingFoundByPersonId,
      allClearAt: incidentReports.missingAllClearSentAt,
      deletedAt: incidentReports.deletedAt,
    })
    .from(incidentReports)
    .where(eq(incidentReports.id, reportId));
  if (!row) throw new Error("report missing");
  return row;
}

async function activityCodes(db: AppDb, f: Fixture) {
  const rows = await db
    .select({ code: activityEvents.code })
    .from(activityEvents)
    .where(and(eq(activityEvents.tripId, f.trip.id)));
  return rows.map((row) => row.code).filter((code) => code.startsWith("missing_diver_"));
}

async function raised(
  db: AppDb,
  input: Awaited<ReturnType<typeof missingSeat>>["input"],
  actorPersonId: string,
  provider: NotificationProvider,
) {
  const result = await raiseMissingDiverAlert(db, { ...input, actorPersonId, provider });
  if (!result.ok || !result.reportId) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result.reportId;
}

describe("Missing diver, alert owners now (issue #2694, in-memory PGlite)", () => {
  it("tells the owners at once from a draft, the report started behind the tap", async () => {
    const { db, f, input } = await missingSeat();
    const { provider, kinds } = recorder();
    const reportId = await raised(db, input, f.crew.id, provider);
    const state = await stateOf(db, reportId);
    expect(state).toMatchObject({ kind: "missing_diver", status: "draft", raisedBy: f.crew.id });
    expect(state.raisedAt).toBeInstanceOf(Date);
    expect(state.sentAt).toBeInstanceOf(Date);
    expect(kinds("incident_missing_diver")).toBeGreaterThan(0);
    expect(push.calls).toBe(1);
    expect(await activityCodes(db, f)).toEqual(["missing_diver_alert_raised"]);
    // "Start a missing diver report" opens the same report.
    expect(await startMissingDiverReport(db, { ...input, actorPersonId: f.crew.id })).toEqual({
      ok: true,
      reportId,
      reused: true,
    });
  });

  it("is one alert for a double tap, and for a second crew member's tap", async () => {
    const { db, f, input } = await missingSeat();
    const { provider, kinds } = recorder();
    // PGlite is one connection, so the taps run one after the other here; the
    // advisory lock is what serializes them on Postgres.
    const first = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider,
    });
    const second = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider,
    });
    expect([first, second].filter((r) => r.ok && !r.alreadyRaised)).toHaveLength(1);
    expect([first, second].filter((r) => r.ok && r.alreadyRaised)).toHaveLength(1);
    const once = kinds("incident_missing_diver");
    expect(once).toBeGreaterThan(0);
    // The owner's tap reuses the crew member's report and sends nothing new.
    const owner = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.owner.id,
      provider,
    });
    expect(owner).toMatchObject({ ok: true, alreadyRaised: true });
    expect(kinds("incident_missing_diver")).toBe(once);
    expect(push.calls).toBe(1);
    expect(await activityCodes(db, f)).toEqual(["missing_diver_alert_raised"]);
  });

  it("counts a filed report's alert as raised: no second alert", async () => {
    const { db, f, input } = await missingSeat();
    const started = await startMissingDiverReport(db, { ...input, actorPersonId: f.crew.id });
    if (!started.ok) throw new Error("start refused");
    const target = { ...input, reportId: started.reportId, actorPersonId: f.crew.id };
    await saveIncidentDraft(db, { ...target, fields: { ...complete, kind: "missing_diver" } });
    const { provider, kinds } = recorder();
    expect(await fileIncidentReport(db, { ...target, provider })).toEqual({ ok: true });
    const once = kinds("incident_missing_diver");
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.crew.id, provider }),
    ).toEqual({ ok: true, reportId: started.reportId, alreadyRaised: true });
    expect(kinds("incident_missing_diver")).toBe(once);
  });

  it("raises from a mark synced late from an offline tablet", async () => {
    const { db, f, input } = await missingSeat("offline");
    const { provider, kinds } = recorder();
    const reportId = await raised(db, input, f.crew.id, provider);
    expect((await stateOf(db, reportId)).raisedAt).toBeInstanceOf(Date);
    expect(kinds("incident_missing_diver")).toBeGreaterThan(0);
  });

  it("refuses another shop's caller, a seat on another departure and a stale tap", async () => {
    const { db, f, input } = await missingSeat();
    const { provider, sent } = recorder();
    expect(
      await raiseMissingDiverAlert(db, {
        ...input,
        shopId: OTHER_SHOP,
        actorPersonId: f.owner.id,
        provider,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    expect(
      await raiseMissingDiverAlert(db, {
        ...input,
        subject: { kind: "diver", bookingId: OTHER_TRIP },
        actorPersonId: f.owner.id,
        provider,
      }),
    ).toEqual({ ok: false, reason: "not_missing" });
    // Marked back aboard since: the tap was read off a stale screen.
    await db.insert(rollCallEvents).values({
      shopId: ctx.shop.id,
      tripId: f.trip.id,
      bookingId: f.seat.booking.id,
      recordedByPersonId: f.crew.id,
      status: "boarded",
      checkpoint: "after_dive_1",
      source: "live",
      occurredAt: new Date(MARKED_AT.getTime() + 60_000),
    });
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.crew.id, provider }),
    ).toEqual({ ok: false, reason: "not_missing" });
    expect(sent).toEqual([]);
  });

  it("refuses staff who are not this departure's crew, an owner or a manager", async () => {
    const { db, f, input } = await missingSeat();
    const { provider, sent } = recorder();
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.ashore.id, provider }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    expect(sent).toEqual([]);
  });

  it("does not alert again for a diver already found", async () => {
    const { db, f, input } = await missingSeat();
    const { provider, kinds } = recorder();
    const reportId = await raised(db, input, f.crew.id, provider);
    const target = { shopId: input.shopId, tripId: input.tripId, reportId, provider };
    expect(await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id })).toEqual({
      ok: true,
      changed: true,
    });
    const alerts = kinds("incident_missing_diver");
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.crew.id, provider }),
    ).toEqual({ ok: false, reason: "already_found" });
    expect(kinds("incident_missing_diver")).toBe(alerts);
  });

  it("keeps a raised draft: it cannot be discarded, and stays a missing-diver report", async () => {
    const { db, f, input } = await missingSeat();
    const reportId = await raised(db, input, f.crew.id, recorder().provider);
    const target = { shopId: input.shopId, tripId: input.tripId, reportId };
    expect(await discardIncidentDraft(db, { ...target, actorPersonId: f.owner.id })).toEqual({
      ok: false,
      reason: "alerted",
    });
    await saveIncidentDraft(db, {
      ...target,
      actorPersonId: f.crew.id,
      fields: { ...complete, kind: "injury" },
    });
    expect(await stateOf(db, reportId)).toMatchObject({ kind: "missing_diver", deletedAt: null });
    // The database holds both, whatever the code above it says.
    await expect(
      db
        .update(incidentReports)
        .set({ deletedAt: nowDate() })
        .where(eq(incidentReports.id, reportId)),
    ).rejects.toThrow();
  });
});

describe("Found: one quiet all-clear (issue #2694, in-memory PGlite)", () => {
  it("emails each owner once, pushes nobody, and records who found them", async () => {
    const { db, f, input } = await missingSeat();
    const reportId = await raised(db, input, f.crew.id, recorder().provider);
    const pushedByAlert = push.calls;
    const { provider, sent, kinds } = recorder();
    const target = { shopId: input.shopId, tripId: input.tripId, reportId, provider };
    expect(await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id })).toEqual({
      ok: true,
      changed: true,
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(kinds("incident_missing_diver_found")).toBe(sent.length);
    expect(push.calls).toBe(pushedByAlert);
    const state = await stateOf(db, reportId);
    expect(state.foundBy).toBe(f.crew.id);
    expect(state.allClearAt).toBeInstanceOf(Date);
    const view = await getIncidentReport(db, input.shopId, reportId, f.owner.id);
    expect(view?.ownersAlert).toMatchObject({ foundByName: f.crew.fullName });
    expect(await activityCodes(db, f)).toEqual([
      "missing_diver_alert_raised",
      "missing_diver_found",
    ]);
  });

  it("sends the all-clear at most once: a second tap, and a retry, send nothing", async () => {
    const { db, f, input } = await missingSeat();
    const reportId = await raised(db, input, f.crew.id, recorder().provider);
    const { provider, sent } = recorder();
    const target = { shopId: input.shopId, tripId: input.tripId, reportId, provider };
    const a = await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id });
    const b = await markMissingDiverFound(db, { ...target, actorPersonId: f.owner.id });
    expect([a, b].filter((r) => r.ok && r.changed)).toHaveLength(1);
    const once = sent.length;
    expect(once).toBeGreaterThan(0);
    expect(await sendMissingDiverAllClear(db, { reportId, provider })).toBe("skipped");
    expect(sent.length).toBe(once);
  });

  it("stops an alert not yet sent: the hourly pass skips a found report", async () => {
    const { db, f, input } = await missingSeat();
    const started = await startMissingDiverReport(db, { ...input, actorPersonId: f.crew.id });
    if (!started.ok) throw new Error("start refused");
    // Raised, but the send at the tap never ran (the stamp alone, as after a crash).
    await db
      .update(incidentReports)
      .set({ missingAlertRaisedAt: nowDate(), missingAlertRaisedByPersonId: f.crew.id })
      .where(eq(incidentReports.id, started.reportId));
    const target = { shopId: input.shopId, tripId: input.tripId, reportId: started.reportId };
    await markMissingDiverFound(db, {
      ...target,
      actorPersonId: f.crew.id,
      provider: recorder().provider,
    });
    const { provider, kinds } = recorder();
    await sendMissingDiverAlerts(db, { provider });
    expect(kinds("incident_missing_diver")).toBe(0);
  });

  it("refuses a report never alerted, staff who may not write it, and another shop", async () => {
    const { db, f, input } = await missingSeat();
    const { provider, sent } = recorder();
    // A plain draft, never raised or filed.
    const plain = await startIncidentReport(db, { ...input, actorPersonId: f.crew.id });
    if (!plain.ok) throw new Error("start refused");
    expect(
      await markMissingDiverFound(db, {
        shopId: input.shopId,
        tripId: input.tripId,
        reportId: plain.reportId,
        actorPersonId: f.crew.id,
        provider,
      }),
    ).toEqual({ ok: false, reason: "not_alerted" });
    const reportId = await raised(db, input, f.crew.id, recorder().provider);
    const target = { shopId: input.shopId, tripId: input.tripId, reportId, provider };
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
    const { db, f, input } = await missingSeat();
    const reportId = await raised(db, input, f.crew.id, recorder().provider);
    const target = {
      shopId: input.shopId,
      tripId: input.tripId,
      reportId,
      actorPersonId: f.crew.id,
    };
    await markMissingDiverFound(db, { ...target, provider: recorder().provider });
    await saveIncidentDraft(db, { ...target, fields: { ...complete, kind: "missing_diver" } });
    expect(await fileIncidentReport(db, { ...target, provider: recorder().provider })).toEqual({
      ok: true,
    });
    expect(
      await addIncidentAddendum(db, { ...target, body: "Found on the reef top, well." }),
    ).toEqual({ ok: true });
  });
});
