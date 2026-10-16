import {
  claimBookkeeperMonth,
  listBookkeeperShops,
  releaseBookkeeperMonth,
  tellOwnersAboutBookkeeper,
} from "@/db/bookkeeper";
import type { AppDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";
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
  /** Held because whoever set the address can no longer export the shop's data. */
  setterLapsed: number;
};

/**
 * **The month-end pass** (fifth loop, item 35; ADR
 * 20261016-bookkeeper-month-end-email): for each real shop with a bookkeeper
 * address whose month is due (`bookkeeperMonthDue`), claim the month, build
 * the three files the Reports zip holds (`monthEndFiles`), and send them.
 *
 * Only a confirmed address is a candidate (security review B1), and only
 * while the person who set it still passes `canPersonExportShopData` (F1): an
 * address a departed manager left behind sends nothing until an owner or
 * manager saves it again, which Reports asks for. Every send also tells every
 * owner where the files went.
 *
 * The claim comes first, so a second pass at once sends nothing; a send that
 * fails, or files that could not be built, give the claim back so the next
 * day's pass tries again. A send the provider accepted but answered with an
 * error is given back too, so the bookkeeper may get that month twice (review
 * N1): a duplicate to the right inbox is the cheaper failure. Logs carry the
 * shop and the month, never the address or the files.
 */
export async function sendDueMonthEndEmails(
  db: AppDb,
  options: { now: Date; provider?: NotificationProvider; origin?: string | null },
): Promise<MonthEndPassSummary> {
  const summary: MonthEndPassSummary = {
    due: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    setterLapsed: 0,
  };
  for (const shop of await listBookkeeperShops(db)) {
    if (!shop.email || !shop.setByPersonId) continue;
    const due = bookkeeperMonthDue(options.now, shop.timezone, shop.sentMonth);
    if (!due) continue;
    summary.due += 1;
    const month = monthKey(due);
    if (!(await canPersonExportShopData(db, shop.id, shop.setByPersonId))) {
      summary.setterLapsed += 1;
      log("bookkeeper.setter_lapsed", "warn", { shopId: shop.id, month });
      continue;
    }
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
        await tellOwnersAboutBookkeeper(db, {
          shop,
          what: { event: "sent", email: shop.email, month },
          at: options.now,
          ...(options.origin === undefined ? {} : { origin: options.origin }),
          ...(options.provider ? { provider: options.provider } : {}),
        });
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
