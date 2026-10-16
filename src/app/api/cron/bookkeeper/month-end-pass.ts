import { claimBookkeeperMonth, listBookkeeperShops, releaseBookkeeperMonth } from "@/db/bookkeeper";
import type { AppDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { bookkeeperMonthDue } from "@/lib/bookkeeper";
import { monthKey } from "@/lib/calendar";
import { log } from "@/lib/log";
import { type NotificationProvider, recipientLocale } from "@/lib/notifications";
import { monthEndFiles } from "../../../shop/[shopSlug]/reports/download/month-end-files";

export type MonthEndPassSummary = {
  due: number;
  sent: number;
  alreadySent: number;
  failed: number;
};

/**
 * **The month-end pass** (fifth loop, item 35; ADR
 * 20261016-bookkeeper-month-end-email): for each real shop with a bookkeeper
 * address whose month is due (`bookkeeperMonthDue`), claim the month, build
 * the three files the Reports zip holds (`monthEndFiles`), and send them.
 *
 * The claim comes first, so a second pass at once sends nothing; a send that
 * fails, or files that could not be built, give the claim back so the next
 * day's pass tries again. Logs carry the shop and the month, never the
 * address or the files.
 */
export async function sendDueMonthEndEmails(
  db: AppDb,
  options: { now: Date; provider?: NotificationProvider },
): Promise<MonthEndPassSummary> {
  const summary: MonthEndPassSummary = { due: 0, sent: 0, alreadySent: 0, failed: 0 };
  for (const shop of await listBookkeeperShops(db)) {
    if (!shop.email) continue;
    const due = bookkeeperMonthDue(options.now, shop.timezone, shop.sentMonth);
    if (!due) continue;
    summary.due += 1;
    const month = monthKey(due);
    if (!(await claimBookkeeperMonth(db, { shopId: shop.id, email: shop.email, month }))) {
      summary.alreadySent += 1;
      continue;
    }
    const release = () =>
      releaseBookkeeperMonth(db, { shopId: shop.id, month, previous: shop.sentMonth });
    try {
      const locale = recipientLocale(null, shop.defaultLocale);
      const files = await monthEndFiles(db, shop, due, options.now, locale);
      const delivery = await sendNotification(
        db,
        {
          kind: "bookkeeper_month_end",
          shopId: shop.id,
          to: shop.email,
          locale,
          shopName: shop.name,
          month,
          attachments: files.map((file) => ({ fileName: file.fileName, content: file.csv })),
        },
        options.provider,
      );
      if (delivery.status === "sent") {
        summary.sent += 1;
      } else {
        summary.failed += 1;
        await release();
        log("bookkeeper.send_failed", "warn", { shopId: shop.id, month, status: delivery.status });
      }
    } catch (error) {
      summary.failed += 1;
      await release();
      log("bookkeeper.shop_failed", "error", {
        shopId: shop.id,
        month,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  return summary;
}
