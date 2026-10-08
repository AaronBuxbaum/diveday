import Link from "next/link";
import { getDb } from "@/db/client";
import { counterRentalTicketIdForOrder } from "@/db/gear-counter-rentals";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

/**
 * The order header's quiet line: when it was raised, and by whom, then its
 * parents beyond the Orders index the eyebrow already spends.
 *
 * When and by whom were missing entirely once: the orders index shows a date
 * column, and losing it on the way into the one order you opened is exactly
 * the detail a refund argument turns on. `created_by_person_id` was already
 * stored, so nothing new is kept.
 *
 * The diver's record rides here rather than in the header's `actions`, as a
 * `link`-weight control: an order has two parents (the Orders index staff
 * arrive from, and the person whose money it is) and the eyebrow can only
 * spend one. Two secondary buttons in the header said the second one at the
 * same weight as the first and left the page's real act, Refund, competing
 * with navigation. A counter rental's invoice has a third parent, the ticket
 * it billed for, linked the same way (ADR 20260815-minimal-gear-register,
 * amended 2026-10-08).
 */
export async function OrderMeta({
  order,
  personId,
  createdByName,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  order: { id: string; shopId: string; createdAt: Date };
  personId: string;
  createdByName: string | null;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const rentalTicketId = await counterRentalTicketIdForOrder(await getDb(), order.shopId, order.id);
  const linkClass = "font-medium text-primary hover:underline";
  return (
    <p className="text-sm text-muted">
      {t("orders.detail.raisedOn", { date: formatShortDate(order.createdAt, locale, timezone) })}
      {createdByName ? ` · ${t("orders.detail.createdBy", { name: createdByName })}` : ""}
      {" · "}
      <Link href={shopPath(shopSlug, "divers", personId)} className={linkClass}>
        {t("orders.detail.diverRecord")}
      </Link>
      {rentalTicketId ? (
        <>
          {" · "}
          <Link href={shopPath(shopSlug, "gear", "rentals", rentalTicketId)} className={linkClass}>
            {t("gear.prep.ticketDoor")}
          </Link>
        </>
      ) : null}
    </p>
  );
}
