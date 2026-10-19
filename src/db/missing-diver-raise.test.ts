import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  discardIncidentDraft,
  fileIncidentReport,
  markMissingDiverFound,
  raiseMissingDiverAlert,
  removeIncidentPerson,
  saveIncidentDraft,
  startMissingDiverReport,
} from "./incident-reports";
import { complete, OTHER_SHOP, OTHER_TRIP } from "./incident-reports-test-fixtures";
import { sendMissingDiverAlerts } from "./missing-diver-alerts";
import {
  type Fixture,
  MARKED_AT,
  mark,
  missingSeat,
  recorder,
  stateOf,
} from "./missing-diver-test-fixtures";
import { ownerLogins } from "./owner-logins";
import { activityEvents, incidentReportPeople, incidentReports, personRoles } from "./schema";

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
 * **"Missing diver, alert owners now"** (issue #2694, decided by Aaron
 * 2026-10-17; domain and security reviews 2026-10-17). Safety-critical, so
 * the failure paths lead: a double tap, a send that reached nobody, a tap
 * synced late from an offline tablet, another shop's caller, staff who may
 * not, a diver missing again after Found, and a roll call that has them back
 * before the hourly pass.
 */
const ctx = fileScopedShopContext();

const seat = () => missingSeat(ctx.db, ctx.shop.id);

async function activityCodes(db: AppDb, f: Fixture) {
  const rows = await db
    .select({ code: activityEvents.code })
    .from(activityEvents)
    .where(and(eq(activityEvents.tripId, f.trip.id)));
  return rows.map((row) => row.code).filter((code) => code.startsWith("missing_diver_"));
}

async function raised(
  db: AppDb,
  input: Awaited<ReturnType<typeof seat>>["input"],
  actorPersonId: string,
  provider: NotificationProvider,
) {
  const result = await raiseMissingDiverAlert(db, { ...input, actorPersonId, provider });
  if (!result.ok || !result.reportId) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result.reportId;
}

const minutesAfterMark = (minutes: number) => new Date(MARKED_AT.getTime() + minutes * 60_000);

describe("Missing diver, alert owners now (issue #2694, in-memory PGlite)", () => {
  it("tells the owners at once from a draft, the report started behind the tap", async () => {
    const { db, f, input } = await seat();
    const { provider, kinds } = recorder();
    const result = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider,
    });
    if (!result.ok || !result.reportId) throw new Error("refused");
    expect(result).toMatchObject({ alreadyRaised: false, told: true });
    const state = await stateOf(db, result.reportId);
    expect(state).toMatchObject({ kind: "missing_diver", status: "draft", raisedBy: f.crew.id });
    expect(state.raisedAt).toBeInstanceOf(Date);
    expect(state.sentAt).toBeInstanceOf(Date);
    expect(state.subjectRowId).not.toBeNull();
    expect(kinds("incident_missing_diver")).toBeGreaterThan(0);
    expect(push.calls).toBe(1);
    expect(await activityCodes(db, f)).toEqual(["missing_diver_alert_raised"]);
    // "Start a missing diver report" opens the same report.
    expect(await startMissingDiverReport(db, { ...input, actorPersonId: f.crew.id })).toEqual({
      ok: true,
      reportId: result.reportId,
      reused: true,
    });
  });

  it("is one alert for a double tap, and for a second crew member's tap", async () => {
    const { db, f, input } = await seat();
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
    expect(first).toMatchObject({ ok: true, alreadyRaised: false, told: true });
    expect(second).toMatchObject({ ok: true, alreadyRaised: true, told: true });
    const once = kinds("incident_missing_diver");
    expect(once).toBeGreaterThan(0);
    // The owner's tap reuses the crew member's report and sends nothing new.
    const owner = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.owner.id,
      provider,
    });
    expect(owner).toMatchObject({ ok: true, alreadyRaised: true, told: true });
    expect(kinds("incident_missing_diver")).toBe(once);
    expect(push.calls).toBe(1);
    expect(await activityCodes(db, f)).toEqual(["missing_diver_alert_raised"]);
  });

  it("never says told when the send reached nobody, and a second tap sends again", async () => {
    const { db, f, input } = await seat();
    const failing = recorder("failed");
    const first = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: failing.provider,
    });
    if (!first.ok || !first.reportId) throw new Error("refused");
    expect(first).toMatchObject({ alreadyRaised: false, told: false });
    expect((await stateOf(db, first.reportId)).sentAt).toBeNull();
    const working = recorder();
    const again = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: working.provider,
    });
    expect(again).toMatchObject({ ok: true, alreadyRaised: true, told: true });
    expect(working.kinds("incident_missing_diver")).toBeGreaterThan(0);
    expect((await stateOf(db, first.reportId)).sentAt).toBeInstanceOf(Date);
    // Told now: a third tap sends nothing more.
    const third = recorder();
    await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider: third.provider,
    });
    expect(third.sent).toEqual([]);
  });

  it("counts a filed report's alert as raised: no second alert", async () => {
    const { db, f, input } = await seat();
    const started = await startMissingDiverReport(db, { ...input, actorPersonId: f.crew.id });
    if (!started.ok) throw new Error("start refused");
    const target = { ...input, reportId: started.reportId, actorPersonId: f.crew.id };
    await saveIncidentDraft(db, { ...target, fields: { ...complete, kind: "missing_diver" } });
    const { provider, kinds } = recorder();
    expect(await fileIncidentReport(db, { ...target, provider })).toEqual({ ok: true });
    const once = kinds("incident_missing_diver");
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.crew.id, provider }),
    ).toEqual({ ok: true, reportId: started.reportId, alreadyRaised: true, told: true });
    expect(kinds("incident_missing_diver")).toBe(once);
  });

  it("raises from a mark synced late from an offline tablet", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id, "offline");
    const { provider, kinds } = recorder();
    const reportId = await raised(db, input, f.crew.id, provider);
    expect((await stateOf(db, reportId)).raisedAt).toBeInstanceOf(Date);
    expect(kinds("incident_missing_diver")).toBeGreaterThan(0);
  });

  it("refuses another shop's caller, a seat on another departure and a stale tap", async () => {
    const { db, f, input } = await seat();
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
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", minutesAfterMark(1));
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.crew.id, provider }),
    ).toEqual({ ok: false, reason: "not_missing" });
    expect(sent).toEqual([]);
  });

  it("refuses staff who are not this departure's crew, an owner or a manager", async () => {
    const { db, f, input } = await seat();
    const { provider, sent } = recorder();
    expect(
      await raiseMissingDiverAlert(db, { ...input, actorPersonId: f.ashore.id, provider }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    expect(sent).toEqual([]);
  });

  it("opens a new report and alerts again for a diver missing again after Found", async () => {
    const { db, f, input } = await seat();
    const first = await raised(db, input, f.crew.id, recorder().provider);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", minutesAfterMark(1));
    expect(
      await markMissingDiverFound(db, {
        shopId: input.shopId,
        tripId: input.tripId,
        reportId: first,
        actorPersonId: f.crew.id,
        provider: recorder().provider,
      }),
    ).toMatchObject({ ok: true, changed: true });
    // Gone again at the next look.
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "not_boarded", minutesAfterMark(2));
    const { provider, kinds } = recorder();
    const again = await raiseMissingDiverAlert(db, {
      ...input,
      actorPersonId: f.crew.id,
      provider,
    });
    expect(again).toMatchObject({ ok: true, alreadyRaised: false, told: true });
    expect(again.ok && again.reportId).not.toBe(first);
    expect(kinds("incident_missing_diver")).toBeGreaterThan(0);
  });

  it("pages nobody from the hourly pass once the roll call has the diver back", async () => {
    const { db, f, input } = await seat();
    // The tap's send reached nobody, so the report waits for the pass.
    const reportId = await raised(db, input, f.crew.id, recorder("failed").provider);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", minutesAfterMark(1));
    const { provider, sent } = recorder();
    await sendMissingDiverAlerts(db, { provider });
    expect(sent).toEqual([]);
    expect((await stateOf(db, reportId)).sentAt).toBeNull();
  });

  it("stops between owners once the diver is marked found mid-send", async () => {
    const { db, f, input } = await seat();
    const reportId = await raised(db, input, f.crew.id, recorder("failed").provider);
    // A second owner with a login, so there is a "between".
    await db.insert(personRoles).values({ personId: f.crew.id, role: "owner" });
    expect((await ownerLogins(db, input.shopId)).length).toBeGreaterThan(1);
    let alarms = 0;
    const provider: NotificationProvider = {
      async send(notification) {
        if (notification.kind === "incident_missing_diver") {
          alarms += 1;
          // Found while the pass is between two owners.
          await db
            .update(incidentReports)
            .set({ missingFoundAt: nowDate(), missingFoundByPersonId: f.crew.id })
            .where(eq(incidentReports.id, reportId));
        }
        return { status: "sent", providerMessageId: `msg-${alarms}` };
      },
    };
    await sendMissingDiverAlerts(db, { provider });
    expect(alarms).toBe(1);
    expect((await stateOf(db, reportId)).sentAt).toBeNull();
  });

  it("keeps a raised draft whole: not discarded, still a missing-diver report, its person kept", async () => {
    const { db, f, input } = await seat();
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
    const { subjectRowId } = await stateOf(db, reportId);
    if (!subjectRowId) throw new Error("expected the raised report's subject row");
    expect(
      await removeIncidentPerson(db, { ...target, actorPersonId: f.crew.id, rowId: subjectRowId }),
    ).toEqual({ ok: false, reason: "alerted" });
    // The database holds all three, whatever the code above it says.
    await expect(
      db
        .update(incidentReports)
        .set({ deletedAt: nowDate() })
        .where(eq(incidentReports.id, reportId)),
    ).rejects.toThrow();
    await expect(
      db.delete(incidentReportPeople).where(eq(incidentReportPeople.id, subjectRowId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(incidentReports)
        .set({ missingSubjectRowId: null })
        .where(eq(incidentReports.id, reportId)),
    ).rejects.toThrow();
  });
});
