import type { DbExecutor } from "@/db/client";
import { queryAll } from "@/db/query-helpers";
import { staffTranslator } from "@/i18n/staff-messages";
import type { MonthRef } from "@/lib/calendar";
import { ordersMonthFile } from "../../orders/download/orders-month-file";
import { crewSheetFile } from "../../settings/export/crew-sheet/crew-sheet-file";
import { type MonthFileShop, monthReportFile } from "./month-report-file";

/**
 * **A month's three files for the bookkeeper** (fifth loop, item 35): the
 * report, the orders and the crew sheet, built by the same functions their
 * own download doors use. One list, read by "Download month-end files" on
 * Reports (one zip) and by the month-end email (three attachments), so the
 * download and the email always carry the same files.
 */
export async function monthEndFiles(
  db: DbExecutor,
  shop: MonthFileShop,
  month: MonthRef,
  now: Date,
  locale: string,
): Promise<{ fileName: string; csv: string }[]> {
  // `queryAll`, never `Promise.all` over one executor: it runs them one by
  // one should a transaction ever be passed in (security review N5).
  return queryAll(db, [
    () => monthReportFile(db, shop, month, now, staffTranslator(locale)),
    () => ordersMonthFile(db, shop, month),
    () => crewSheetFile(db, shop, month, locale),
  ]);
}
