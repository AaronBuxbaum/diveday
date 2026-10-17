import { and, eq, gte, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { notificationTripTitle } from "@/lib/notifications/kinds";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb } from "./client";
import { affectedSubjects, rollCallHasThemBack } from "./missing-subject";
import { sendNotification } from "./notifications";
import { ownerLogins } from "./owner-logins";
import { pushTripAlert } from "./push-subscriptions";
import { incidentReports, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **A filed report of a missing diver tells the owners at once** (H-142,
 * decided 2026-10-16; the stale roll-call alert it rides beside is H-118,
 * `src/db/roll-call-alerts.ts`). Whoever filed the report chose "missing
 * diver" on purpose, so the shop does not wait for the roll call to go stale:
 * every active owner gets one email, and the devices following the
 * departure's manifest one push, for each report.
 *
 * The same recipients as the stale alert, re-read live at send time
 * (`ownerLogins`, `pushTripAlert`): a demoted owner, a disabled login or a
 * follower who left hears nothing. The shop's shore contact is not included:
 * their consent was given for the stale roll-call alert (H-118) and this is
 * not that message.
 *
 * **Counts nothing, names nobody.** The mail says a missing diver was reported
 * on this departure and when it happened, with a link to the report behind the
 * staff sign-in and one to the emergency reference; the report is personal and
 * medical data.
 *
 * **Told means every owner's email was sent.** A push is an extra and never
 * counts: a report whose owners were not all emailed is tried again (an owner
 * who did get it may get a second copy; that is the price of never losing the
 * alert). The pass takes a report under a lease (`missing_alerted_at`, a
 * conditional update, so two passes never send at once) and writes
 * `missing_alert_sent_at` only when every owner email was sent. A failure gives
 * the lease back at once; a crash leaves it to run out
 * (`MISSING_DIVER_LEASE_MS`), so no failure loses the alert. Filing a report
 * calls this for that report; the hourly crew-notices pass calls it for every
 * filed report of the last few hours, which is the retry, and says so to the
 * cron monitor when one stays unalerted (`overdue`).
 *
 * **Raised from the roll call, or filed** (issue #2694): "Missing diver, alert
 * owners now" stamps a draft `missing_alert_raised_at`, and it is told exactly
 * as a filed report is, from the raise; filing it afterwards sends nothing
 * new. A report marked found (`missing_found_at`) is never told: a found diver
 * must not wake anybody. Its all-clear is `sendMissingDiverAllClear` below.
 *
 * A report of something that happened long before it was filed
 * (`MISSING_DIVER_PUSH_STALE_MS`), or filed a while ago, goes by email only: a
 * push to the whole manifest's followers is for a diver who may be missing now.
 * Never for a rehearsal, a cancelled departure or a demo shop, and never for a
 * report that is a draft, discarded, or any other kind.
 */

/** How far back the hourly pass looks for a filed report whose owners were never told. */
export const MISSING_DIVER_ALERT_LOOKBACK_MS = 6 * 60 * 60 * 1000;

/** How long a pass holds a report before another may take it: past any send, short of the cron. */
export const MISSING_DIVER_LEASE_MS = 10 * 60 * 1000;

/** An incident this long before the report was filed is history, not an emergency: email only. */
export const MISSING_DIVER_PUSH_STALE_MS = 6 * 60 * 60 * 1000;

/** The push goes with the first sends only; a retry later than this emails alone. */
export const MISSING_DIVER_PUSH_WINDOW_MS = 15 * 60 * 1000;

/** A filed report still not sent this long after filing is told to the cron monitor. */
export const MISSING_DIVER_OVERDUE_MS = 30 * 60 * 1000;

export type MissingDiverAlertSummary = {
  checked: number;
  /** Reports whose owners this pass told. */
  alerted: number;
  emails: number;
  pushes: number;
  /** Leases given back because an owner email, or all of them, did not go. */
  released: number;
  /** Reports still not told, filed longer ago than `MISSING_DIVER_OVERDUE_MS`. */
  overdue: number;
};

export async function sendMissingDiverAlerts(
  db: AppDb,
  input: {
    /** Only this report: the one just filed. Omitted, every filed report of the lookback. */
    reportId?: string;
    now?: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  } = {},
): Promise<MissingDiverAlertSummary> {
  const now = input.now ?? nowDate();
  const summary: MissingDiverAlertSummary = {
    checked: 0,
    alerted: 0,
    emails: 0,
    pushes: 0,
    released: 0,
    overdue: 0,
  };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  const leaseEnds = new Date(now.getTime() - MISSING_DIVER_LEASE_MS);
  const notLeased = or(
    isNull(incidentReports.missingAlertedAt),
    lte(incidentReports.missingAlertedAt, leaseEnds),
  );
  const lookbackFrom = new Date(now.getTime() - MISSING_DIVER_ALERT_LOOKBACK_MS);
  const due = await db
    .select({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      tripTitle: trips.title,
      filedAt: incidentReports.filedAt,
      raisedAt: incidentReports.missingAlertRaisedAt,
      occurredAt: incidentReports.occurredAt,
      slug: shops.slug,
      shopName: shops.name,
      defaultLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(incidentReports)
    .innerJoin(
      trips,
      and(eq(trips.id, incidentReports.tripId), eq(trips.shopId, incidentReports.shopId)),
    )
    .innerJoin(shops, eq(shops.id, incidentReports.shopId))
    .where(
      and(
        input.reportId ? eq(incidentReports.id, input.reportId) : undefined,
        alertStands,
        isNull(incidentReports.missingAlertSentAt),
        notLeased,
        or(
          gte(incidentReports.filedAt, lookbackFrom),
          gte(incidentReports.missingAlertRaisedAt, lookbackFrom),
        ),
        liveTrip(),
        // A cancelled departure never pages (as the stale roll-call alert).
        eq(trips.status, "scheduled"),
        // A rehearsal sends nothing to anyone (ADR 20261012-rehearsal-departures).
        notRehearsal(),
        // A demo shop's owner's address is anybody's.
        eq(shops.isDemo, false),
      ),
    );
  summary.checked = due.length;
  const overdueBefore = new Date(now.getTime() - MISSING_DIVER_OVERDUE_MS);
  const isOverdue = (startedAt: Date | null) => startedAt !== null && startedAt <= overdueBefore;
  if (!origin) {
    // Nothing can be linked, so nothing is sent: said loudly, because a filed
    // report is waiting on it. Counts only, never a name.
    if (due.length > 0)
      log("incident.missing_diver_alert_no_origin", "error", { reports: due.length });
    summary.overdue = due.filter((report) => isOverdue(alertStartedAt(report))).length;
    return summary;
  }
  let failure: unknown;

  for (const report of due) {
    // Raised from the roll call, and the roll call has them back since
    // (review 2026-10-17): nobody is paged for a diver already aboard.
    if (report.raisedAt) {
      const subjects = await affectedSubjects(db, report.shopId, report.id);
      if (await rollCallHasThemBack(db, { ...report, subjects })) continue;
    }
    const claimed = await db
      .update(incidentReports)
      .set({ missingAlertedAt: now })
      .where(
        and(
          eq(incidentReports.id, report.id),
          eq(incidentReports.shopId, report.shopId),
          alertStands,
          isNull(incidentReports.missingAlertSentAt),
          notLeased,
        ),
      )
      .returning({ id: incidentReports.id });
    if (claimed.length === 0) continue;
    let ownersTold = false;
    try {
      const reportPath = shopPath(report.slug, "trips", report.tripId, "incidents", report.id);
      const emergencyPath = shopPath(report.slug, "settings", "emergency-reference");
      // `trips.title` is unbounded and the kind caps it: clipped here, so a
      // long title shortens the subject rather than failing every send.
      const tripTitle = notificationTripTitle(report.tripTitle);
      const owners = await ownerLogins(db, report.shopId);
      let sent = 0;
      for (const owner of owners) {
        // Found meanwhile: no owner gets the alarm after the all-clear.
        if (await foundSince(db, report)) break;
        const delivery = await sendNotification(
          db,
          {
            kind: "incident_missing_diver",
            shopId: report.shopId,
            personId: owner.personId,
            tripId: report.tripId,
            incidentReportId: report.id,
            to: owner.email,
            locale: recipientLocale(owner.locale, report.defaultLocale),
            recipientName: owner.fullName,
            shopName: report.shopName,
            tripTitle,
            reportedAt: report.occurredAt ?? alertStartedAt(report) ?? now,
            timezone: report.timezone,
            reportUrl: `${origin}${reportPath}`,
            emergencyUrl: `${origin}${emergencyPath}`,
          },
          input.provider,
        );
        if (delivery.status === "sent") {
          sent += 1;
          summary.emails += 1;
        }
      }
      ownersTold = owners.length > 0 && sent === owners.length;
      if (withinPushWindow(report, now)) {
        const pushes = await pushTripAlert(db, report.shopId, report.tripId, {
          url: reportPath,
          words: (t) => ({
            title: t("manifest.missingDiverAlert.pushTitle"),
            body: t("manifest.missingDiverAlert.pushBody", { title: tripTitle }),
          }),
        });
        summary.pushes += pushes;
      }
    } catch (error) {
      // The next report still gets its pass; the throw reaches the caller
      // once the pass is done.
      failure ??= error;
    } finally {
      if (ownersTold) {
        await db
          .update(incidentReports)
          .set({ missingAlertSentAt: now })
          .where(and(eq(incidentReports.id, report.id), eq(incidentReports.missingAlertedAt, now)));
        summary.alerted += 1;
      } else {
        await db
          .update(incidentReports)
          .set({ missingAlertedAt: null })
          .where(and(eq(incidentReports.id, report.id), eq(incidentReports.missingAlertedAt, now)));
        summary.released += 1;
        if (isOverdue(alertStartedAt(report))) summary.overdue += 1;
      }
    }
  }
  // Ids and counts only — never a name or an address.
  log("incident.missing_diver_alert_pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}

/**
 * A report whose owners are owed the alert: a missing-diver report, filed or
 * raised from the roll call, not discarded, not found.
 */
const alertStands = and(
  eq(incidentReports.kind, "missing_diver"),
  or(eq(incidentReports.status, "filed"), isNotNull(incidentReports.missingAlertRaisedAt)),
  isNull(incidentReports.deletedAt),
  isNull(incidentReports.missingFoundAt),
);

/** Whether the report was marked found since this pass took it. */
async function foundSince(db: AppDb, report: { id: string; shopId: string }): Promise<boolean> {
  const [row] = await db
    .select({ foundAt: incidentReports.missingFoundAt })
    .from(incidentReports)
    .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)))
    .limit(1);
  return row?.foundAt != null;
}

/** When the alert was first asked for: the raise from the roll call, or else the filing. */
function alertStartedAt(report: { filedAt: Date | null; raisedAt: Date | null }): Date | null {
  return report.raisedAt ?? report.filedAt;
}

/** A push is for a diver who may be missing now: a recent raise or filing of a recent incident. */
function withinPushWindow(
  report: { filedAt: Date | null; raisedAt: Date | null; occurredAt: Date | null },
  now: Date,
): boolean {
  const startedAt = alertStartedAt(report);
  if (!startedAt || !report.occurredAt) return false;
  if (now.getTime() - startedAt.getTime() > MISSING_DIVER_PUSH_WINDOW_MS) return false;
  return startedAt.getTime() - report.occurredAt.getTime() <= MISSING_DIVER_PUSH_STALE_MS;
}

export type MissingDiverAllClearOutcome = "sent" | "partial" | "skipped";

/**
 * **One quiet all-clear** (issue #2694, decided by Aaron 2026-10-17): when a
 * missing diver is marked found, each active owner gets one email saying the
 * diver reported missing on this departure was found, and when, and how many
 * are still reported missing on it (a count, never a name). Email only: no
 * push wakes the boat's followers, who are the ones who found them.
 *
 * The recipients are the alert's (`ownerLogins`, re-read live), on a report
 * of this shop whose alert was raised or filed. **At most once**: the report
 * is claimed (`missing_all_clear_claimed_at`) before any send, so two taps or
 * a retry never send a second all-clear; `missing_all_clear_sent_at` is
 * written only once every owner's email went, so the report page can say
 * when it did not. A failed send is logged, not retried: the found stands on
 * the report either way, and the owner's first instruction was to call the
 * boat. Never for a rehearsal or a demo shop, which are never alerted; a
 * departure cancelled or removed since the alert still gets it.
 */
export async function sendMissingDiverAllClear(
  db: AppDb,
  input: {
    shopId: string;
    reportId: string;
    now?: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<MissingDiverAllClearOutcome> {
  const now = input.now ?? nowDate();
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  const [report] = await db
    .update(incidentReports)
    .set({ missingAllClearClaimedAt: now })
    .where(
      and(
        eq(incidentReports.id, input.reportId),
        eq(incidentReports.shopId, input.shopId),
        eq(incidentReports.kind, "missing_diver"),
        or(eq(incidentReports.status, "filed"), isNotNull(incidentReports.missingAlertRaisedAt)),
        isNotNull(incidentReports.missingFoundAt),
        isNull(incidentReports.missingAllClearClaimedAt),
        isNull(incidentReports.deletedAt),
      ),
    )
    .returning({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      foundAt: incidentReports.missingFoundAt,
    });
  if (!report?.foundAt) return "skipped";
  const [context] = await db
    .select({
      tripTitle: trips.title,
      slug: shops.slug,
      shopName: shops.name,
      defaultLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        eq(trips.id, report.tripId),
        eq(trips.shopId, report.shopId),
        // diveday:allow-deleted-trips: an owner told of a missing diver is told they were found, whatever became of the departure since.
        notRehearsal(),
        eq(shops.isDemo, false),
      ),
    )
    .limit(1);
  if (!context || !origin) {
    if (context && !origin) log("incident.missing_diver_all_clear_no_origin", "error", {});
    return "skipped";
  }
  const stillMissing = await stillReportedMissing(db, report);
  const reportPath = shopPath(context.slug, "trips", report.tripId, "incidents", report.id);
  const owners = await ownerLogins(db, report.shopId);
  let sent = 0;
  for (const owner of owners) {
    const delivery = await sendNotification(
      db,
      {
        kind: "incident_missing_diver_found",
        shopId: report.shopId,
        personId: owner.personId,
        tripId: report.tripId,
        incidentReportId: report.id,
        to: owner.email,
        locale: recipientLocale(owner.locale, context.defaultLocale),
        recipientName: owner.fullName,
        shopName: context.shopName,
        tripTitle: notificationTripTitle(context.tripTitle),
        foundAt: report.foundAt,
        stillMissing,
        timezone: context.timezone,
        reportUrl: `${origin}${reportPath}`,
      },
      input.provider,
    ).catch(() => ({ status: "failed" as const }));
    if (delivery.status === "sent") sent += 1;
  }
  const everyOwner = owners.length > 0 && sent === owners.length;
  if (everyOwner) {
    await db
      .update(incidentReports)
      .set({ missingAllClearSentAt: nowDate() })
      .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)));
  }
  // Ids and counts only.
  log("incident.missing_diver_all_clear", "info", { owners: owners.length, sent });
  return everyOwner ? "sent" : "partial";
}

/** Other alerted reports on the departure whose person is not found yet: a count for the all-clear. */
async function stillReportedMissing(
  db: AppDb,
  report: { id: string; shopId: string; tripId: string },
): Promise<number> {
  const rows = await db
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.shopId, report.shopId),
        eq(incidentReports.tripId, report.tripId),
        ne(incidentReports.id, report.id),
        alertStands,
      ),
    );
  return rows.length;
}
