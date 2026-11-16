import { aliasedTable, and, asc, eq, isNull, lte } from "drizzle-orm";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { publicSchedulePath } from "@/lib/public-routes";
import { isWithinSendWindow } from "@/lib/send-window";
import type { AppDb, DbExecutor } from "./client";
import { packageOrderStillBacks } from "./dive-packages";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { findOrCreatePerson } from "./people";
import {
  divePackages,
  orderLineItems,
  orders,
  type PackageGift,
  packageGifts,
  people,
  shops,
} from "./schema";

/**
 * **A dive package bought for someone else** (issue #4629; ADR
 * 20260822-a-package-is-entitlements-not-money, amendment 2026-11-16).
 *
 * The buyer pays and gets the receipt; the dives go straight to the person at
 * the recipient's email when the order is paid, with no claim step; one gift
 * mail tells them, on the date the buyer chose, in the shop's zone.
 */

export type PackageGiftInput = {
  /** As the buyer typed them. */
  fullName: string;
  email: string;
  /** The shop-local date the gift mail goes out. */
  sendOn: CalendarDate;
};

/**
 * Write the gift for an order just raised: the recipient is the person at the
 * typed email, or a new diver record under the typed name. The address is the
 * whole point of a gift, so it attaches whoever holds it: what they receive is
 * dives, and nothing about the buyer or the order is shown to them but the
 * buyer's name in the mail.
 */
export async function recordPackageGift(
  db: DbExecutor,
  input: { shopId: string; orderId: string; recipient: PackageGiftInput },
): Promise<PackageGift> {
  const { person } = await findOrCreatePerson(db, {
    shopId: input.shopId,
    fullName: input.recipient.fullName,
    email: input.recipient.email,
    origin: "public_order",
  });
  const [gift] = await db
    .insert(packageGifts)
    .values({
      shopId: input.shopId,
      orderId: input.orderId,
      recipientPersonId: person.id,
      sendOn: input.recipient.sendOn,
    })
    .returning();
  if (!gift) throw new Error("recordPackageGift: insert returned no row");
  return gift;
}

export type PackageGiftSweep = { sent: number; failed: number };

/**
 * The shop tick's gift mail: every gift whose date has come in its shop's
 * zone, inside the shop's send window, whose order still backs the dives.
 *
 * - **Unpaid**: waits. The dives are granted only at `paid`, so the mail goes
 *   on the first tick after payment, however late.
 * - **Refunded, or a lost dispute, before the date**: never sent. The dives
 *   are no longer spendable, so there is nothing to tell.
 * - **The shop stopped selling the package** before the date: sent. The
 *   recipient's dives were bought and granted; the package row outlives its
 *   sale (`divePackages.deletedAt`), and its name is what the mail says.
 *
 * Claimed before the send (`sent_at` stamped where it is still null), so two
 * ticks never mail one gift twice; a provider failure goes through the send
 * queue's own retry.
 */
export async function sendDuePackageGifts(
  db: AppDb,
  options: { now?: Date; emailProvider?: NotificationProvider; appOrigin?: string | null } = {},
): Promise<PackageGiftSweep> {
  const now = options.now ?? nowDate();
  const buyer = aliasedTable(people, "buyer");
  // The latest date anywhere on earth today; each row is checked again in its
  // own shop's zone below.
  const latestToday = calendarDateInTimezone(now, "Pacific/Kiritimati");
  const due = await db
    .select({
      gift: packageGifts,
      shop: {
        id: shops.id,
        name: shops.name,
        slug: shops.slug,
        timezone: shops.timezone,
        defaultLocale: shops.defaultLocale,
      },
      recipient: { fullName: people.fullName, email: people.email, locale: people.locale },
      buyerName: buyer.fullName,
      packageName: divePackages.name,
      diveCount: divePackages.diveCount,
    })
    .from(packageGifts)
    .innerJoin(shops, eq(shops.id, packageGifts.shopId))
    .innerJoin(
      orders,
      and(eq(orders.id, packageGifts.orderId), eq(orders.shopId, packageGifts.shopId)),
    )
    // diveday:allow-deleted-people: an erased recipient has no email and is skipped below.
    .innerJoin(people, eq(people.id, packageGifts.recipientPersonId))
    // diveday:allow-deleted-people: the buyer's name as it stood; only the name is read.
    .innerJoin(buyer, eq(buyer.id, orders.personId))
    .innerJoin(
      orderLineItems,
      and(
        eq(orderLineItems.orderId, orders.id),
        eq(orderLineItems.shopId, orders.shopId),
        eq(orderLineItems.kind, "dive_package"),
      ),
    )
    // A package the shop stopped selling still names the dives it gave: no deleted_at filter.
    .innerJoin(divePackages, eq(divePackages.id, orderLineItems.packageId))
    .where(
      and(
        isNull(packageGifts.sentAt),
        lte(packageGifts.sendOn, latestToday),
        packageOrderStillBacks(),
      ),
    )
    .orderBy(asc(packageGifts.sendOn), asc(packageGifts.createdAt));

  const provider = notificationProviderForDb(options.emailProvider);
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  const summary: PackageGiftSweep = { sent: 0, failed: 0 };
  for (const row of due) {
    const { gift, shop, recipient } = row;
    if (gift.sendOn > calendarDateInTimezone(now, shop.timezone)) continue;
    if (!isWithinSendWindow(now, shop.timezone)) continue;
    if (!recipient.email) continue;
    const [claimed] = await db
      .update(packageGifts)
      .set({ sentAt: now })
      .where(and(eq(packageGifts.id, gift.id), isNull(packageGifts.sentAt)))
      .returning({ id: packageGifts.id });
    if (!claimed) continue;
    const delivery = await sendNotification(
      db,
      {
        kind: "package_gift",
        giftId: gift.id,
        shopId: shop.id,
        to: recipient.email,
        locale: recipientLocale(recipient.locale, shop.defaultLocale),
        recipientName: recipient.fullName,
        buyerName: row.buyerName,
        shopName: shop.name,
        packageName: row.packageName,
        diveCount: row.diveCount,
        ...(origin
          ? { bookUrl: new URL(publicSchedulePath(shop.slug), `${origin}/`).toString() }
          : {}),
      },
      provider,
    );
    if (delivery.status === "sent") summary.sent += 1;
    else {
      summary.failed += 1;
      log("package_gift.not_sent", "warn", { giftId: gift.id, status: delivery.status });
    }
  }
  return summary;
}
