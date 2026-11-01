import { getDb } from "@/db/client";
import { listOrderLinesForExport, ORDER_EXPORT_MAX_LINES } from "@/db/order-export";
import { canPersonViewShopReports } from "@/db/reporting";
import { listSeatPaymentsForExport } from "@/db/seat-payments";
import { getShopById } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { exportDateStamp } from "@/lib/export";
import { requireStaffSession } from "@/lib/session";
import { orderIndexFilter } from "../order-index-filter";
import { ordersCsv } from "./orders-csv";

/**
 * CSV export uses the index filter (UX review 3, item 34) and includes every
 * matching page. The database rechecks the owner/manager role, and a route
 * slug that does not match the session shop returns 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop || shop.slug !== shopSlug) return new Response("Not found", { status: 404 });
  if (!(await canPersonViewShopReports(db, shop.id, session.user.personId))) {
    return new Response("Order exports are limited to the shop's owner or manager.", {
      status: 403,
    });
  }

  const now = nowDate();
  const search = new URL(request.url).searchParams;
  const { filter } = orderIndexFilter(
    {
      status: search.get("status") ?? undefined,
      personId: search.get("personId") ?? undefined,
      q: search.get("q") ?? undefined,
      tripId: search.get("tripId") ?? undefined,
      seats: search.get("seats") ?? undefined,
      from: search.get("from") ?? undefined,
      to: search.get("to") ?? undefined,
      range: search.get("range") ?? undefined,
    },
    shop.timezone,
    now,
  );
  // Include online seat payments under the same filter (UX review 4, item 18).
  const [lines, seats] = await Promise.all([
    listOrderLinesForExport(db, shop.id, filter),
    listSeatPaymentsForExport(db, shop.id, filter, ORDER_EXPORT_MAX_LINES),
  ]);
  const fileName = `diveday-orders-${shop.slug}-${exportDateStamp(now, shop.timezone)}.csv`;
  return new Response(ordersCsv(lines, seats, shop.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
