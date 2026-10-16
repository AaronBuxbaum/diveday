import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { notificationTripTitle } from "@/lib/notifications/kinds";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb } from "./client";
import { sendNotification } from "./notifications";
import { ownerLogins } from "./owner-logins";
import { pushTripAlert } from "./push-subscriptions";
import { incidentReports, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **A filed report of a missing diver tells the owners at once** (H-126,
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
  const due = await db
    .select({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      tripTitle: trips.title,
      filedAt: incidentReports.filedAt,
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
        eq(incidentReports.status, "filed"),
        eq(incidentReports.kind, "missing_diver"),
        isNull(incidentReports.deletedAt),
        isNull(incidentReports.missingAlertSentAt),
        notLeased,
        gte(incidentReports.filedAt, new Date(now.getTime() - MISSING_DIVER_ALERT_LOOKBACK_MS)),
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
  const isOverdue = (filedAt: Date | null) => filedAt !== null && filedAt <= overdueBefore;
  if (!origin) {
    // Nothing can be linked, so nothing is sent: said loudly, because a filed
    // report is waiting on it. Counts only, never a name.
    if (due.length > 0)
      log("incident.missing_diver_alert_no_origin", "error", { reports: due.length });
    summary.overdue = due.filter((report) => isOverdue(report.filedAt)).length;
    return summary;
  }
  let failure: unknown;

  for (const report of due) {
    const claimed = await db
      .update(incidentReports)
      .set({ missingAlertedAt: now })
      .where(
        and(
          eq(incidentReports.id, report.id),
          eq(incidentReports.shopId, report.shopId),
          eq(incidentReports.status, "filed"),
          eq(incidentReports.kind, "missing_diver"),
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
            reportedAt: report.occurredAt ?? report.filedAt ?? now,
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
        if (isOverdue(report.filedAt)) summary.overdue += 1;
      }
    }
  }
  // Ids and counts only — never a name or an address.
  log("incident.missing_diver_alert_pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}

/** A push is for a diver who may be missing now: a recent filing of a recent incident. */
function withinPushWindow(
  report: { filedAt: Date | null; occurredAt: Date | null },
  now: Date,
): boolean {
  if (!report.filedAt || !report.occurredAt) return false;
  if (now.getTime() - report.filedAt.getTime() > MISSING_DIVER_PUSH_WINDOW_MS) return false;
  return report.filedAt.getTime() - report.occurredAt.getTime() <= MISSING_DIVER_PUSH_STALE_MS;
}
