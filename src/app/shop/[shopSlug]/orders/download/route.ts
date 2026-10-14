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
 * **"Download orders (CSV)"**: the Orders ledger, as filtered, for a
 * bookkeeper (third UX review, item 34). One row per order line
 * (`ordersCsv`), under the index's own reading of the URL
 * (`orderIndexFilter`), so the file holds the orders the page shows across
 * every page of them, and nothing the page would not.
 *
 * Security-sensitive: a bulk file of diver names and money. The gate is the
 * Reports CSV's (`canPersonViewShopReports`, owner or manager), re-checked
 * against the database so it closes the moment a manager is demoted, and the
 * shop is the session's, never the route's slug; a slug that names another
 * shop is a 404 rather than this shop's file under that shop's name.
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
      from: search.get("from") ?? undefined,
      to: search.get("to") ?? undefined,
      range: search.get("range") ?? undefined,
    },
    shop.timezone,
    now,
  );
  // The seats divers paid for online ride beside the orders (fourth UX review,
  // item 18), under the same filter, so the file matches the ledger on screen.
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
