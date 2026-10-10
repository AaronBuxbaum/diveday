import Link from "next/link";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import type { OpenPaymentDispute } from "@/db/payment-disputes";
import type { DiverLocale } from "@/i18n/settings";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
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
 * amended 2026-10-08). The page reads that ticket (`loadOrderHeader`) and hands it in.
 */
export function OrderMeta({
  order,
  personId,
  createdBy,
  rentalTicketId,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  order: { createdAt: Date };
  personId: string;
  /**
   * Who raised it, or `online` when the diver bought it on the shop's public
   * pages and nobody on the staff did.
   */
  createdBy: { name: string | null; online: boolean };
  /** The counter-rental ticket this invoice billed for, when it billed for one. */
  rentalTicketId: string | null;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const linkClass = "font-medium text-primary hover:underline";
  return (
    <p className="text-sm text-muted">
      {t("orders.detail.raisedOn", { date: formatShortDate(order.createdAt, locale, timezone) })}
      {createdBy.online
        ? ` · ${t("orders.detail.boughtOnline")}`
        : createdBy.name
          ? ` · ${t("orders.detail.createdBy", { name: createdBy.name })}`
          : ""}
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

/**
 * A card dispute the diver's bank opened against this order and has not
 * decided (ADR 20261009-stripe-reversals-reach-diveday): the amount, and the
 * date Stripe needs the shop's evidence by. Today carries the same row; here
 * it sits on the money it is about. Renders nothing when there is none; the
 * page's `loadOrderHeader` withholds it from a reader who may not see the
 * shop's money.
 */
export function OrderDisputeBanner({
  dispute,
  timezone,
  locale,
  t,
}: {
  dispute: OpenPaymentDispute | null;
  timezone: string;
  locale: DiverLocale;
  t: StaffTranslator;
}) {
  if (!dispute) return null;
  const amount = formatMoneyCents(dispute.amountCents, dispute.currency, locale);
  return (
    <StaffNoticeBanner tone="warning">
      {dispute.evidenceDueBy
        ? t("orders.detail.disputeOpen", {
            amount,
            due: formatShortDate(dispute.evidenceDueBy, locale, timezone),
          })
        : t("orders.detail.disputeOpenNoDeadline", { amount })}
    </StaffNoticeBanner>
  );
}
