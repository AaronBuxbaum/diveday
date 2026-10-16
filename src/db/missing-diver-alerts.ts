import { and, eq, gte, isNull } from "drizzle-orm";
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
 * every active owner gets one email and every device following the
 * departure's manifest gets one push, once per report.
 *
 * The same recipients as the stale alert, re-read live at send time
 * (`ownerLogins`, `pushTripAlert`): a demoted owner, a disabled login or a
 * follower who left hears nothing. The shop's shore contact is not included:
 * their consent was given for the stale roll-call alert (H-118) and this is
 * not that message.
 *
 * **Counts nothing, names nobody.** The mail says a missing diver was reported
 * on this departure and when, with a link to the report behind the staff
 * sign-in; the report is personal and medical data.
 *
 * Claimed on the report (`incident_reports.missing_alerted_at`, a conditional
 * update, so a second pass cannot send again), and given back in `finally`
 * when the send reached nobody or threw, so no failure leaves a report marked
 * alerted with nothing sent. Filing a report calls this for that report; the
 * hourly crew-notices pass calls it for every filed report of the last day,
 * which is the retry. Never for a rehearsal or a demo shop, and never for a
 * report that is a draft, discarded, or any other kind.
 */

/** How far back the hourly pass looks for a filed report that never reached anyone. */
export const MISSING_DIVER_ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type MissingDiverAlertSummary = {
  checked: number;
  /** Reports this pass reached somebody about. */
  alerted: number;
  emails: number;
  pushes: number;
  /** Claims given back because no owner email or push landed. */
  released: number;
};

export async function sendMissingDiverAlerts(
  db: AppDb,
  input: {
    /** Only this report: the one just filed. Omitted, every filed report of the last day. */
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
  };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return summary;
  const due = await db
    .select({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      tripTitle: trips.title,
      filedAt: incidentReports.filedAt,
      slug: shops.slug,
      shopName: shops.name,
      defaultLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(incidentReports)
    .innerJoin(trips, eq(trips.id, incidentReports.tripId))
    .innerJoin(shops, eq(shops.id, incidentReports.shopId))
    .where(
      and(
        input.reportId ? eq(incidentReports.id, input.reportId) : undefined,
        eq(incidentReports.status, "filed"),
        eq(incidentReports.kind, "missing_diver"),
        isNull(incidentReports.deletedAt),
        isNull(incidentReports.missingAlertedAt),
        gte(incidentReports.filedAt, new Date(now.getTime() - MISSING_DIVER_ALERT_LOOKBACK_MS)),
        liveTrip(),
        // A rehearsal sends nothing to anyone (ADR 20261012-rehearsal-departures).
        notRehearsal(),
        // A demo shop's owner's address is anybody's.
        eq(shops.isDemo, false),
      ),
    );
  summary.checked = due.length;
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
          isNull(incidentReports.missingAlertedAt),
        ),
      )
      .returning({ id: incidentReports.id });
    if (claimed.length === 0) continue;
    let reached = 0;
    try {
      const reportPath = shopPath(report.slug, "trips", report.tripId, "incidents", report.id);
      // `trips.title` is unbounded and the kind caps it: clipped here, so a
      // long title shortens the subject rather than failing every send.
      const tripTitle = notificationTripTitle(report.tripTitle);
      for (const owner of await ownerLogins(db, report.shopId)) {
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
            reportedAt: report.filedAt ?? now,
            timezone: report.timezone,
            reportUrl: `${origin}${reportPath}`,
          },
          input.provider,
        );
        if (delivery.status === "sent") {
          reached += 1;
          summary.emails += 1;
        }
      }
      const pushes = await pushTripAlert(db, report.shopId, report.tripId, {
        url: reportPath,
        words: (t) => ({
          title: t("manifest.missingDiverAlert.pushTitle"),
          body: t("manifest.missingDiverAlert.pushBody", { title: tripTitle }),
        }),
      });
      reached += pushes;
      summary.pushes += pushes;
    } catch (error) {
      // The next report still gets its pass; the throw reaches the caller
      // once the pass is done.
      failure ??= error;
    } finally {
      if (reached === 0) {
        await db
          .update(incidentReports)
          .set({ missingAlertedAt: null })
          .where(and(eq(incidentReports.id, report.id), eq(incidentReports.missingAlertedAt, now)));
        summary.released += 1;
      } else {
        summary.alerted += 1;
      }
    }
  }
  // Ids and counts only — never a name or an address.
  log("incident.missing_diver_alert_pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}
