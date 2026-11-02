import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { IncidentDraftFields } from "@/lib/incident-reports";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { demoteOwnerToManager } from "@/test/staff-session";
import type { AppDb } from "./client";
import {
  fileIncidentReport,
  getIncidentReport,
  saveIncidentDraft,
  startIncidentReport,
} from "./incident-reports";
import {
  MISSING_DIVER_ALERT_LOOKBACK_MS,
  MISSING_DIVER_LEASE_MS,
  MISSING_DIVER_OVERDUE_MS,
  sendMissingDiverAlerts,
} from "./missing-diver-alerts";
import { incidentReports, personRoles, shops, trips, userAccounts } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";

// The push half of the send path, counted and made to throw on demand: the
// email half reports a provider failure as a status, so a throw is the database's.
const push = vi.hoisted(() => ({ calls: 0, throws: false, reaches: 0 }));
vi.mock("./push-subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./push-subscriptions")>();
  return {
    ...actual,
    pushTripAlert: async () => {
      push.calls += 1;
      if (push.throws) throw new Error("push exploded");
      return push.reaches;
    },
  };
});
afterEach(() => {
  push.calls = 0;
  push.throws = false;
  push.reaches = 0;
});

/**
 * H-20261016-missing-diver-report-alerts (issue #2598): a filed incident report of kind "missing diver" tells
 * the owners at once, once per report. Safety-critical, so the failure paths
 * lead: another kind, a draft, a rehearsal, a demo shop, a second filing, a
 * send that reached nobody, a send that threw, and a recipient who is no
 * longer an owner.
 */
const ctx = fileScopedShopContext();

const SECRET_WORDS = "Ana Ruiz went down the line at 18 m and has not surfaced.";

const missing: IncidentDraftFields = {
  occurredAt: new Date(nowDate().getTime() - 20 * 60 * 1000),
  diveSiteId: null,
  locationText: "North wall mooring",
  whatHappened: SECRET_WORDS,
  kind: "missing_diver",
  severity: "serious",
  firstAidGiven: false,
  oxygenGiven: false,
  oxygenMinutes: null,
  emergencyServicesCalled: true,
  handoverKind: "none",
  handoverDetail: null,
  handedOverAt: null,
  followUp: null,
};

function recorder(status: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return status === "sent"
        ? { status: "sent", providerMessageId: `msg-${sent.length}` }
        : { status: "failed", retryable: false, errorCode: "test" };
    },
  };
  return { sent, provider };
}

/** A real shop's booked departure, its crew member, and its owner. */
async function fixture(db: AppDb, shopId: string) {
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shopId));
  const trip = (await upcomingTripsWithCounts(db, shopId)).find((row) => row.booked > 0);
  const staff = await listStaff(db, shopId);
  const owner = staff.find((member) => member.roles.includes("owner"))?.person;
  if (!trip || !owner) throw new Error("expected a booked trip and an owner");
  return { trip, owner };
}

async function draft(fields: IncidentDraftFields, tripId?: string) {
  const { db, shop } = ctx;
  const { trip, owner } = await fixture(db, shop.id);
  const target = { shopId: shop.id, tripId: tripId ?? trip.id, actorPersonId: owner.id };
  const started = await startIncidentReport(db, target);
  if (!started.ok) throw new Error("start refused");
  const saved = await saveIncidentDraft(db, { ...target, reportId: started.reportId, fields });
  if (!saved.ok) throw new Error("save refused");
  return { db, shop, trip, owner, target: { ...target, reportId: started.reportId } };
}

async function claimOf(reportId: string) {
  const [row] = await ctx.db
    .select({ at: incidentReports.missingAlertedAt })
    .from(incidentReports)
    .where(eq(incidentReports.id, reportId));
  return row?.at ?? null;
}

async function sentAtOf(reportId: string) {
  const [row] = await ctx.db
    .select({ at: incidentReports.missingAlertSentAt })
    .from(incidentReports)
    .where(eq(incidentReports.id, reportId));
  return row?.at ?? null;
}

/** A provider that fails for the named recipients only. */
function failingFor(addresses: string[]) {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      if ("to" in notification && addresses.includes(notification.to)) {
        return { status: "failed", retryable: false, errorCode: "test" };
      }
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  return { sent, provider };
}

describe("filing a report of a missing diver", () => {
  it("emails every owner once, with a link and no name, and pushes the manifest's followers once", async () => {
    const { db, target, trip } = await draft(missing);
    const { sent, provider } = recorder();
    push.reaches = 2;
    expect(await fileIncidentReport(db, { ...target, provider })).toEqual({ ok: true });
    expect(sent.length).toBeGreaterThan(0);
    expect(push.calls).toBe(1);
    for (const notification of sent) {
      if (notification.kind !== "incident_missing_diver") throw new Error("wrong kind");
      expect(notification).toMatchObject({ tripId: trip.id, incidentReportId: target.reportId });
      expect(notification.reportUrl).toBe(
        `https://dive.day/shop/${ctx.shop.slug}/trips/${trip.id}/incidents/${target.reportId}`,
      );
      // The fact and a link: nothing the report holds.
      const everything = JSON.stringify(notification);
      expect(everything).not.toContain("Ana Ruiz");
      expect(everything).not.toContain("18 m");
      expect(everything).not.toContain("North wall");
    }
    expect(await sentAtOf(target.reportId)).toBeInstanceOf(Date);
  });

  it("sends nothing a second time, from the sweep or a repeat", async () => {
    const { db, target } = await draft(missing);
    const first = recorder();
    await fileIncidentReport(db, { ...target, provider: first.provider });
    const count = first.sent.length;
    const again = recorder();
    expect(await sendMissingDiverAlerts(db, { provider: again.provider })).toMatchObject({
      checked: 0,
      alerted: 0,
    });
    expect(await fileIncidentReport(db, { ...target, provider: again.provider })).toEqual({
      ok: false,
      reason: "filed",
    });
    expect(again.sent).toHaveLength(0);
    expect(count).toBeGreaterThan(0);
    expect(push.calls).toBe(1);
  });

  it("sends nothing for any other kind of report", async () => {
    for (const kind of ["injury", "near_miss", "equipment", "fatality", "other"] as const) {
      const { db, target } = await draft({ ...missing, kind });
      const { sent, provider } = recorder();
      await fileIncidentReport(db, { ...target, provider });
      expect(sent).toHaveLength(0);
    }
    expect(push.calls).toBe(0);
  });

  it("sends nothing for a draft, even one that already says missing diver", async () => {
    const { db } = await draft(missing);
    const { sent, provider } = recorder();
    expect(await sendMissingDiverAlerts(db, { provider })).toMatchObject({ checked: 0 });
    expect(sent).toHaveLength(0);
    expect(push.calls).toBe(0);
  });

  it("never alerts about a rehearsal, or from a demo shop", async () => {
    const rehearsal = await draft(missing);
    await rehearsal.db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, rehearsal.trip.id));
    const first = recorder();
    await fileIncidentReport(rehearsal.db, { ...rehearsal.target, provider: first.provider });
    expect(first.sent).toHaveLength(0);

    const demo = await draft(missing);
    await demo.db.update(trips).set({ isRehearsal: false }).where(eq(trips.id, demo.trip.id));
    await demo.db.update(shops).set({ isDemo: true }).where(eq(shops.id, demo.shop.id));
    const second = recorder();
    await fileIncidentReport(demo.db, { ...demo.target, provider: second.provider });
    expect(second.sent).toHaveLength(0);
    expect(push.calls).toBe(0);
  });

  it("gives the claim back when nobody was reached, and the next pass tries again", async () => {
    const { db, target } = await draft(missing);
    const failing = recorder("failed");
    expect(await fileIncidentReport(db, { ...target, provider: failing.provider })).toEqual({
      ok: true,
    });
    expect(await claimOf(target.reportId)).toBeNull();

    const retry = recorder();
    expect(await sendMissingDiverAlerts(db, { provider: retry.provider })).toMatchObject({
      alerted: 1,
      released: 0,
    });
    expect(retry.sent.length).toBeGreaterThan(0);
    expect(await sentAtOf(target.reportId)).toBeInstanceOf(Date);
  });

  it("does not count a push as reaching the owners: every email fails, the push reaches one device, the next pass retries", async () => {
    const { db, target } = await draft(missing);
    push.reaches = 1;
    await fileIncidentReport(db, { ...target, provider: recorder("failed").provider });
    expect(push.calls).toBe(1);
    expect(await claimOf(target.reportId)).toBeNull();
    expect(await sentAtOf(target.reportId)).toBeNull();
    const retry = recorder();
    expect(await sendMissingDiverAlerts(db, { provider: retry.provider })).toMatchObject({
      alerted: 1,
    });
    expect(retry.sent.length).toBeGreaterThan(0);
  });

  it("retries when one of two owners failed, and stops once both were sent", async () => {
    const { db, shop, target, owner } = await draft(missing);
    const second = (await listStaff(db, shop.id)).find(
      (member) => !member.roles.includes("owner"),
    )?.person;
    if (!second) throw new Error("expected a second staff member");
    await db.insert(personRoles).values({ personId: second.id, role: "owner" });
    const [account] = await db
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .where(eq(userAccounts.personId, owner.id));
    if (!account) throw new Error("expected a login");
    const half = failingFor([account.email]);
    await fileIncidentReport(db, { ...target, provider: half.provider });
    expect(half.sent).toHaveLength(1);
    expect(await sentAtOf(target.reportId)).toBeNull();
    expect(await claimOf(target.reportId)).toBeNull();

    const retry = recorder();
    expect(await sendMissingDiverAlerts(db, { provider: retry.provider })).toMatchObject({
      alerted: 1,
    });
    // Only the owner the first send missed: who it reached is on the report
    // now (#2828), so nobody is paged twice.
    expect(retry.sent.map((notification) => notification.to)).toEqual([account.email]);
    expect(await sentAtOf(target.reportId)).toBeInstanceOf(Date);
    const done = recorder();
    expect(await sendMissingDiverAlerts(db, { provider: done.provider })).toMatchObject({
      checked: 0,
    });
  });

  it("keeps a lease a crashed pass left until it runs out, then takes the report again", async () => {
    const { db, target } = await draft(missing);
    await fileIncidentReport(db, { ...target, provider: recorder("failed").provider });
    // A pass that took the report and died before it sent anything.
    const crashedAt = nowDate();
    await db
      .update(incidentReports)
      .set({ missingAlertedAt: crashedAt })
      .where(eq(incidentReports.id, target.reportId));
    const early = recorder();
    expect(
      await sendMissingDiverAlerts(db, {
        now: new Date(crashedAt.getTime() + MISSING_DIVER_LEASE_MS - 60_000),
        provider: early.provider,
      }),
    ).toMatchObject({ checked: 0 });
    expect(early.sent).toHaveLength(0);
    const late = recorder();
    expect(
      await sendMissingDiverAlerts(db, {
        now: new Date(crashedAt.getTime() + MISSING_DIVER_LEASE_MS + 1_000),
        provider: late.provider,
      }),
    ).toMatchObject({ checked: 1, alerted: 1 });
    expect(late.sent.length).toBeGreaterThan(0);
    expect(await sentAtOf(target.reportId)).toBeInstanceOf(Date);
  });

  it("never pages for a cancelled departure", async () => {
    const { db, target, trip } = await draft(missing);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    const { sent, provider } = recorder();
    await fileIncidentReport(db, { ...target, provider });
    expect(sent).toHaveLength(0);
    expect(push.calls).toBe(0);
  });

  it("emails but does not push for an incident long before the filing", async () => {
    const { db, target } = await draft({
      ...missing,
      occurredAt: new Date(nowDate().getTime() - 7 * 60 * 60 * 1000),
    });
    push.reaches = 3;
    const { sent, provider } = recorder();
    await fileIncidentReport(db, { ...target, provider });
    expect(sent.length).toBeGreaterThan(0);
    expect(push.calls).toBe(0);
  });

  it("carries the incident time and the emergency reference link in the mail", async () => {
    const { db, target } = await draft(missing);
    const { sent, provider } = recorder();
    await fileIncidentReport(db, { ...target, provider });
    const first = sent[0];
    if (first?.kind !== "incident_missing_diver") throw new Error("wrong kind");
    expect(first.reportedAt).toEqual(missing.occurredAt);
    expect(first.emergencyUrl).toBe(
      `https://dive.day/shop/${ctx.shop.slug}/settings/emergency-reference`,
    );
  });

  it("counts a report still untold past the overdue wait", async () => {
    const { db, target } = await draft(missing);
    await fileIncidentReport(db, { ...target, provider: recorder("failed").provider });
    const soon = new Date(nowDate().getTime() + 5 * 60 * 1000);
    expect(
      await sendMissingDiverAlerts(db, { now: soon, provider: recorder("failed").provider }),
    ).toMatchObject({ released: 1, overdue: 0 });
    const later = new Date(nowDate().getTime() + MISSING_DIVER_OVERDUE_MS + 60_000);
    expect(
      await sendMissingDiverAlerts(db, { now: later, provider: recorder("failed").provider }),
    ).toMatchObject({ released: 1, overdue: 1 });
  });

  it("tells the report's reader whether the owners were reached", async () => {
    const { db, shop, owner, target } = await draft(missing);
    const read = () => getIncidentReport(db, shop.id, target.reportId, owner.id);
    // A draft has told nobody anything.
    expect((await read())?.ownersAlert).toBeNull();
    await fileIncidentReport(db, { ...target, provider: recorder("failed").provider });
    expect((await read())?.ownersAlert).toEqual({
      sentAt: null,
      foundAt: null,
      foundByName: null,
      allClear: null,
    });
    await sendMissingDiverAlerts(db, { provider: recorder().provider });
    expect((await read())?.ownersAlert?.sentAt).toBeInstanceOf(Date);
  });

  it("stays filed when the send path throws, gives the claim back, and rethrows from the pass", async () => {
    const { db, target } = await draft(missing);
    push.throws = true;
    expect(
      await fileIncidentReport(db, { ...target, provider: recorder("failed").provider }),
    ).toEqual({ ok: true });
    const [row] = await db
      .select({ status: incidentReports.status })
      .from(incidentReports)
      .where(eq(incidentReports.id, target.reportId));
    expect(row?.status).toBe("filed");
    expect(await claimOf(target.reportId)).toBeNull();

    await expect(
      sendMissingDiverAlerts(db, { provider: recorder("failed").provider }),
    ).rejects.toThrow("push exploded");
    push.throws = false;
    expect(await sendMissingDiverAlerts(db, { provider: recorder().provider })).toMatchObject({
      alerted: 1,
    });
  });

  it("leaves a report older than the look-back to a human", async () => {
    const { db, target } = await draft(missing);
    await fileIncidentReport(db, { ...target, provider: recorder("failed").provider });
    const later = new Date(nowDate().getTime() + MISSING_DIVER_ALERT_LOOKBACK_MS + 60_000);
    const { sent, provider } = recorder();
    expect(await sendMissingDiverAlerts(db, { now: later, provider })).toMatchObject({
      checked: 0,
    });
    expect(sent).toHaveLength(0);
  });

  it("re-reads the owners at send time: a demoted owner hears nothing, the new owner does", async () => {
    const { db, shop, target, owner } = await draft(missing);
    const successor = (await listStaff(db, shop.id)).find(
      (member) => !member.roles.includes("owner"),
    )?.person;
    if (!successor) throw new Error("expected a second staff member");
    await db.insert(personRoles).values({ personId: successor.id, role: "owner" });
    const emailOf = async (personId: string) => {
      const [account] = await db
        .select({ email: userAccounts.email })
        .from(userAccounts)
        .where(eq(userAccounts.personId, personId));
      if (!account) throw new Error("expected a login");
      return account.email;
    };
    const demotedEmail = await emailOf(owner.id);
    const successorEmail = await emailOf(successor.id);
    await demoteOwnerToManager(db, owner.id);
    const { sent, provider } = recorder();
    await fileIncidentReport(db, { ...target, provider });
    const to = sent.map((notification) => notification.to);
    expect(to).toContain(successorEmail);
    expect(to).not.toContain(demotedEmail);
  });

  it("sends nothing when the public origin is not known, keeps the claim free and counts it overdue", async () => {
    const { db, target } = await draft(missing);
    await fileIncidentReport(db, { ...target, provider: recorder("failed").provider });
    const { sent, provider } = recorder();
    const later = new Date(nowDate().getTime() + MISSING_DIVER_OVERDUE_MS + 60_000);
    expect(await sendMissingDiverAlerts(db, { origin: null, now: later, provider })).toMatchObject({
      checked: 1,
      overdue: 1,
    });
    expect(sent).toHaveLength(0);
    expect(await claimOf(target.reportId)).toBeNull();
  });
});
