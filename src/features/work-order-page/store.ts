import { assistsAvailable } from "@/features/assists";
import { getWorkOrderDetail } from "@/features/work-orders";
import type { AppDb } from "../../db/client";
import { latestServiceClocks } from "../../db/gear";
import { listStaff } from "../../db/trips";
import type { CalendarDate } from "../../lib/calendar-date";

/**
 * The work order page's question in one call: the ticket, the shop's staff,
 * a shop unit's last reading of each service clock (so the Work done form
 * carries the fleet's own interval forward), and, for a live ticket, whether
 * assists can draft its bench note. Null when the ticket is not this shop's.
 */
export async function getWorkOrderPage(
  db: AppDb,
  shopId: string,
  workOrderId: string,
  options: { todayLocal: CalendarDate },
) {
  const [detail, staff] = await Promise.all([
    getWorkOrderDetail(db, shopId, workOrderId, options),
    listStaff(db, shopId),
  ]);
  if (!detail) return null;
  const { workOrder } = detail;
  const deleted = workOrder.deletedAt !== null;
  const gearItemId = workOrder.gearItemId;
  const [clocks, draftNote] = await Promise.all([
    gearItemId
      ? latestServiceClocks(db, shopId, [gearItemId]).then((byItem) => byItem.get(gearItemId) ?? [])
      : [],
    deleted ? false : assistsAvailable(db, shopId),
  ]);
  return { detail, staff, clocks, can: { draftNote } };
}
