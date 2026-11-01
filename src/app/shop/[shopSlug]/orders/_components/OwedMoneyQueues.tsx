import Link from "next/link";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { PaidAfterCloseCheckout } from "@/db/checkouts-paid-after-close";
import type { listFailedRefunds } from "@/db/refund-failures";
import type { OwedShopCancellationRefund } from "@/db/refunds";
import type { UnattributedRefund } from "@/db/unattributed-refunds";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate, joinFacts } from "@/lib/format";
import { matchStripeRefundAction, refundPaidAfterCloseAction } from "../actions";
import { FACT_SEPARATOR, NOTICE_ROWS, OPEN_TRIP_LINE, OPEN_TRIP_LINK } from "./notice-rows";

/**
 * The Orders index's money queues, in the order a shop works them: what it
 * owes for a cancelled departure, money paid after a checkout closed, refunds
 * made in Stripe waiting for a seat, and refunds that failed. Each renders
 * nothing while it is empty.
 */
export function MoneyOwedQueues({
  queues,
  ...shared
}: Omit<QueueProps<never>, "queue"> & {
  queues: {
    owedRefunds: OwedShopCancellationRefund[];
    paidAfterClose: PaidAfterCloseCheckout[];
    unattributedRefunds: UnattributedRefund[];
    failedRefunds: Awaited<ReturnType<typeof listFailedRefunds>>;
  };
}) {
  return (
    <>
      <OwedRefundsQueue queue={queues.owedRefunds} {...shared} />
      <PaidAfterCloseQueue queue={queues.paidAfterClose} {...shared} />
      <UnattributedRefundsQueue queue={queues.unattributedRefunds} {...shared} />
      <FailedRefundsQueue queue={queues.failedRefunds} {...shared} />
    </>
  );
}

type QueueProps<Row> = {
  queue: Row[];
  shopSlug: string;
  timeZone: string;
  locale: string;
  t: StaffTranslator;
};

/**
 * Cancellation refunds the shop still owes a diver. Use a warning because
 * money is due, but nothing is broken; omit the queue when empty.
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
            // Keep this as running text: separators stay with the preceding
            // fact on phone wraps, and “Open trip” stays inline (K-569).
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
 * Card payments that arrive after checkout closes, each with its refund.
 * Omit the queue when empty.
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
 * Refunds Stripe reports failed or canceled after DiveDay counted them; the
 * money is still owed to the diver. Omit the queue when empty.
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

/**
 * A dashboard refund on a party checkout identifies an amount, not a seat.
 * Offer the seats still holding its money for staff to match; do not split it
 * automatically. Omit the queue when none is waiting.
 */
export function UnattributedRefundsQueue({
  queue,
  shopSlug,
  timeZone,
  locale,
  t,
}: QueueProps<UnattributedRefund>) {
  if (queue.length === 0) return null;
  return (
    <section aria-label={t("orders.index.unattributedRefunds.sectionLabel")} className="mb-6">
      <ShopNotice tone="warning" role="status">
        <p className="font-medium">
          {t("orders.index.unattributedRefunds.heading", { count: queue.length })}
        </p>
        <ul className={NOTICE_ROWS}>
          {queue.map((held) => (
            <li key={held.intentId}>
              {held.tripTitle ? <span className="font-medium">{held.tripTitle}</span> : null}
              <span className="text-muted">
                {held.tripTitle ? FACT_SEPARATOR : null}
                {joinFacts([
                  formatMoneyCents(held.amountCents, held.currency, locale),
                  formatShortDate(held.refundedAt, locale, timeZone),
                ])}
              </span>{" "}
              <span className={OPEN_TRIP_LINE}>
                <Link href={`/shop/${shopSlug}/trips/${held.tripId}`} className={OPEN_TRIP_LINK}>
                  {t("orders.index.unattributedRefunds.openTrip")}
                </Link>
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {held.seats.map((seat) => (
                  <form key={seat.bookingId} action={matchStripeRefundAction}>
                    <input type="hidden" name="intentId" value={held.intentId} />
                    <input type="hidden" name="bookingId" value={seat.bookingId} />
                    <SubmitButton
                      pendingLabel={t("orders.index.unattributedRefunds.matching")}
                      className={buttonClass({ variant: "secondary" })}
                    >
                      {t("orders.index.unattributedRefunds.seat", {
                        diver: seat.diverName,
                        held: formatMoneyCents(seat.heldCents, held.currency, locale),
                      })}
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </ShopNotice>
    </section>
  );
}
