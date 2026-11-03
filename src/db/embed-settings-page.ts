import type { AppDb } from "./client";
import { listActiveCourses } from "./courses";
import { pagedUpcomingTripsWithCounts } from "./trips";

export { canPersonManageShopSettings } from "./authz";

/**
 * The embed settings page's question in one call: the next thirty public
 * departures a widget can frame, and the active courses in the roster's
 * progression order.
 */
export async function getEmbedSettingsPage(db: AppDb, shopId: string, now: Date) {
  const [{ trips }, courses] = await Promise.all([
    pagedUpcomingTripsWithCounts(db, shopId, { now, limit: 30, publicOnly: true }),
    listActiveCourses(db, shopId),
  ]);
  return { trips, courses };
}
