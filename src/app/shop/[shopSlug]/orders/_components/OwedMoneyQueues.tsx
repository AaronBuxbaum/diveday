import Link from "next/link";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { PaidAfterCloseCheckout } from "@/db/checkouts-paid-after-close";
import type { listFailedRefunds } from "@/db/refund-failures";
import type { OwedShopCancellationRefund } from "@/db/refunds";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate, joinFacts } from "@/lib/format";
import { refundPaidAfterCloseAction } from "../actions";
import { FACT_SEPARATOR, NOTICE_ROWS, OPEN_TRIP_LINE, OPEN_TRIP_LINK } from "./notice-rows";

type QueueProps<Row> = {
  queue: Row[];
  shopSlug: string;
  timeZone: string;
  locale: string;
  t: StaffTranslator;
};

/**
 * Cancellation refunds the shop still owes a diver. Renders nothing when
 * nothing is owed: a queue, not a heading that sits on the page announcing
 * its own emptiness. Warning rather than danger: nothing is broken, somebody
 * is just owed money.
 */
export function OwedRefundsQueue({
  queue,
  shopSlug,
  timeZone,
  locale,
  t,
}: QueueProps<OwedShopCancellationRefund>) {
  if (queue.length === 0) return null;
  return (
    <section aria-label={t("orders.index.owedRefunds.sectionLabel")} className="mb-6">
      <ShopNotice tone="warning" role="status">
        <p className="font-medium">
          {t("orders.index.owedRefunds.heading", { count: queue.length })}
        </p>
        <p className="mt-1 text-sm">{t("orders.index.owedRefunds.detail")}</p>
        <ul className={NOTICE_ROWS}>
          {queue.map((owed) => (
            // **Running text, not flex items** (K-569). Each fact was a
            // flex item opening on its own "·", so the row spaced its
            // dots two ways and, wrapped on a phone, began lines
            // "· $60.00"; and a single joined span, as one flex item,
            // left the name's line whole on a phone and pushed "Open
            // trip" to a line of its own. As one run of text the row
            // breaks only after a dot or inside the departure's words,
            // every dot bound to the word before it, and "Open trip"
            // (a 20px `inline-flex` on the text's baseline) shares the
            // last line.
            <li key={owed.bookingId}>
              <span className="font-medium">{owed.diverName}</span>
              {FACT_SEPARATOR}
              {owed.tripTitle}
              <span className="text-muted">
                {FACT_SEPARATOR}
                {joinFacts([
                  // A counter mark often records no amount. Saying so
                  // beats printing a confident 0.00 the shop would have
                  // to distrust.
                  owed.amountCents === null
                    ? t("orders.index.owedRefunds.unrecordedAmount")
                    : formatMoneyCents(owed.amountCents, owed.currency, locale),
                  owed.depositOnly && t("orders.index.owedRefunds.depositOnly"),
                  formatShortDate(owed.tripStartsAt, locale, timeZone),
                ])}
              </span>{" "}
              <span className={OPEN_TRIP_LINE}>
                <Link href={`/shop/${shopSlug}/trips/${owed.tripId}`} className={OPEN_TRIP_LINK}>
                  {t("orders.index.owedRefunds.openTrip")}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </ShopNotice>
    </section>
  );
}

/**
 * Money a diver's card paid on a checkout DiveDay had already closed (issue
 * #2335), each with its refund. Renders nothing while nothing is owed.
 */
export function PaidAfterCloseQueue({
  queue,
  shopSlug,
  timeZone,
  locale,
  t,
}: QueueProps<PaidAfterCloseCheckout>) {
  if (queue.length === 0) return null;
  return (
    <section aria-label={t("orders.index.paidAfterClose.sectionLabel")} className="mb-6">
      <ShopNotice tone="warning" role="status">
        <p className="font-medium">
          {t("orders.index.paidAfterClose.heading", { count: queue.length })}
        </p>
        <ul className={NOTICE_ROWS}>
          {queue.map((owed) => (
            <li key={owed.checkoutId}>
              <span className="font-medium">{owed.diverNames.join(", ")}</span>
              {FACT_SEPARATOR}
              {owed.tripTitle}
              <span className="text-muted">
                {FACT_SEPARATOR}
                {joinFacts([
                  formatMoneyCents(owed.amountCents, owed.currency, locale),
                  formatShortDate(owed.tripStartsAt, locale, timeZone),
                ])}
              </span>{" "}
              <span className={OPEN_TRIP_LINE}>
                <Link href={`/shop/${shopSlug}/trips/${owed.tripId}`} className={OPEN_TRIP_LINK}>
                  {t("orders.index.paidAfterClose.openTrip")}
                </Link>
              </span>
              <form action={refundPaidAfterCloseAction} className="mt-2">
                <input type="hidden" name="checkoutId" value={owed.checkoutId} />
                <SubmitButton
                  pendingLabel={t("orders.index.paidAfterClose.refunding")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("orders.index.paidAfterClose.refund")}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </ShopNotice>
    </section>
  );
}

/**
 * Refunds Stripe reported failed or canceled after DiveDay counted them
 * (issue #2291): the money is still the diver's. Renders nothing while none is
 * owed.
 */
export function FailedRefundsQueue({
  queue,
  shopSlug,
  timeZone,
  locale,
  t,
}: QueueProps<Awaited<ReturnType<typeof listFailedRefunds>>[number]>) {
  if (queue.length === 0) return null;
  return (
    <section aria-label={t("orders.index.failedRefunds.sectionLabel")} className="mb-6">
      <ShopNotice tone="warning" role="status">
        <p className="font-medium">
          {t("orders.index.failedRefunds.heading", { count: queue.length })}
        </p>
        <ul className={NOTICE_ROWS}>
          {queue.map((owed) => (
            <li key={owed.id}>
              <span className="font-medium">{owed.diverNames.join(", ")}</span>
              {owed.tripTitle ? (
                <>
                  {FACT_SEPARATOR}
                  {owed.tripTitle}
                </>
              ) : null}
              <span className="text-muted">
                {FACT_SEPARATOR}
                {joinFacts([
                  formatMoneyCents(owed.amountCents, owed.currency, locale),
                  formatShortDate(owed.failedAt, locale, timeZone),
                ])}
              </span>{" "}
              {owed.orderId ? (
                <span className={OPEN_TRIP_LINE}>
                  <Link
                    href={`/shop/${shopSlug}/orders/${owed.orderId}`}
                    className={OPEN_TRIP_LINK}
                  >
                    {t("orders.index.failedRefunds.openOrder")}
                  </Link>
                </span>
              ) : owed.tripId ? (
                <span className={OPEN_TRIP_LINE}>
                  <Link href={`/shop/${shopSlug}/trips/${owed.tripId}`} className={OPEN_TRIP_LINK}>
                    {t("orders.index.failedRefunds.openTrip")}
                  </Link>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </ShopNotice>
    </section>
  );
}
