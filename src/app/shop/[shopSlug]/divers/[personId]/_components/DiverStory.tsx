import Link from "next/link";
import { type BookingStoryMoney, BookingStoryRow } from "@/components/person/rows";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel, LedgerGroup } from "@/components/ui/ledger";
import type { OrderStatus, PaymentStatus } from "@/db/schema";
import { ORDER_STATUS_KEYS } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate, formatTime } from "@/lib/format";
import { SHOP_HISTORY_PREVIEW_COUNT } from "@/lib/prior-visits";
import { bookingIsAhead } from "../_lib/status";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import { bookingMoney, bookingMoneyStatusKey, type DiverProfile, type Shop } from "./shared";

/**
 * **The story — one chronological ledger of everything this diver has done
 * with the shop** (ADR 20260827-people-not-lists, decision 1).
 *
 * It replaces three lists that told one story three times: Upcoming, Payments
 * (a row per order, named after the trip it billed for) and Shop history. A
 * staffer scrolling the record read the same Saturday charter twice and then
 * had to work out what was different about each telling. Now a seat appears
 * exactly once, in date order, carrying its own money fact — because "is
 * Saturday paid?" is a question about Saturday.
 *
 * Three kinds of row share the ledger and must never read alike:
 *
 * - a **booking** on a departure this shop ran (or is about to) — a door to
 *   the manifest while it is ahead, to the trip once it is behind;
 * - an **imported visit**, which is a booking record the diver's previous
 *   system held: evidence a seat was reserved, not evidence anybody got in the
 *   water. Marked, and never a door (ADR 20260725-import-prior-visits, enforced
 *   inside `BookingStoryRow` itself);
 * - a **person-level order** with no booking behind it — a shop payment that
 *   belongs to the person rather than to a seat. Its door is the order.
 *
 * Money is a *fact* of the row, never a control: refunds and the invoice
 * itself stay first-class on the Orders ledger, one tap away, where the refund
 * form can take a partial amount. The record's own money act is the status
 * ledger's "Collect", plus the quiet "+ New invoice" at this ledger's foot.
 */

/** How the row is weighted, from the order that raised it. See `BookingStoryRow`. */
const ORDER_MONEY_STATE: Record<OrderStatus, BookingStoryMoney["state"]> = {
  open: "open",
  paid: "paid",
  // Nothing is owed on a voided invoice, so it is quiet — the word "Void" on
  // the row is what carries the difference from "Paid".
  void: "paid",
  uncollectible: "refunded",
  partly_refunded: "refunded",
  refunded: "refunded",
};

/** The same question of a booking that never had an order raised against it. */
const PAYMENT_MONEY_STATE: Record<PaymentStatus, BookingStoryMoney["state"]> = {
  unpaid: "open",
  deposit_paid: "open",
  paid: "paid",
  // Written off deliberately: nothing is outstanding, and the word says so.
  waived: "paid",
  partly_refunded: "refunded",
  refunded: "refunded",
};

/**
 * What one seat's money stands at, in words and in weight — or nothing at all
 * when nobody has raised anything against it. An absence is not a fact worth a
 * pill (`BookingStoryRow`), and "No order" down every row of a shop that
 * settles at the counter is a permanent red mark on an ordinary way of
 * trading.
 */
function seatMoney(
  diver: DiverProfile,
  bookingId: string,
  t: StaffTranslator,
  locale: string,
): BookingStoryMoney | undefined {
  const money = bookingMoney(diver, bookingId);
  const key = bookingMoneyStatusKey(money);
  if (!key) return undefined;
  const word = t(key);
  if (money.order) {
    const { order } = money.order;
    return {
      state: ORDER_MONEY_STATE[order.status] ?? "open",
      label: `${word} · ${formatMoneyCents(order.totalCents, order.currency, locale)}`,
    };
  }
  const status = money.payment?.payment.status;
  return { state: status ? (PAYMENT_MONEY_STATE[status] ?? "open") : "open", label: word };
}

type StoryEntry = {
  key: string;
  /** The instant the row sorts by. Imported visits carry a calendar date at noon UTC. */
  at: number;
  ahead: boolean;
  row: React.ReactNode;
};

export function DiverStory({
  diver,
  shop,
  shopSlug,
  personId,
  locale,
  t,
  paymentsConnected,
  status,
  now = nowDate(),
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  /**
   * A shop with no payable Stripe account cannot raise an invoice at all —
   * `orders/new` refuses outright — so the foot's one act is simply absent
   * rather than a link that bounces. Connecting payments is a Settings errand
   * and the ADR took its CTA off the person page.
   */
  paymentsConnected: boolean;
  /**
   * This ledger's own outcome — in practice the one bounce `orders/new` can
   * still send back here, when a shop that cannot take money reaches the
   * invoice door by a stale tab or a hand-typed URL.
   */
  status?: DiverNotice;
  now?: Date;
}) {
  const entries: StoryEntry[] = [];

  for (const entry of diver.bookings) {
    const { booking, trip, course } = entry;
    const ahead = bookingIsAhead(entry, now);
    const meta = [
      formatTime(trip.startsAt, locale, shop.timezone),
      course?.title,
      ahead
        ? diver.waiver.state === "current"
          ? t("divers.story.waiverSigned")
          : undefined
        : t("divers.story.sailed"),
    ].filter(Boolean) as string[];
    entries.push({
      key: `booking:${booking.id}`,
      at: trip.startsAt.getTime(),
      ahead,
      row: (
        <BookingStoryRow
          key={`booking:${booking.id}`}
          t={t}
          date={formatShortDate(trip.startsAt, locale, shop.timezone)}
          title={trip.title}
          meta={meta.join(" · ")}
          money={seatMoney(diver, booking.id, t, locale)}
          // What staff come here to do about a boat that has not left happens
          // on the manifest; a departure that is behind them is read on the
          // trip itself.
          href={`/shop/${shopSlug}/trips/${trip.id}${ahead ? "/manifest" : ""}`}
          linkLabel={trip.title}
          past={!ahead}
        />
      ),
    });
  }

  for (const visit of diver.priorVisits) {
    const meta = [visit.sourceLabel, visit.amountLabel, visit.statusLabel].filter(
      Boolean,
    ) as string[];
    entries.push({
      key: `visit:${visit.id}`,
      // Noon rather than midnight so a date-only value cannot sort itself into
      // the wrong day when the shop's zone is read against UTC.
      at: Date.parse(`${visit.visitedOn}T12:00:00Z`),
      ahead: false,
      row: (
        <BookingStoryRow
          key={`visit:${visit.id}`}
          t={t}
          date={formatCalendarDate(visit.visitedOn, locale)}
          title={visit.title ?? t("divers.history.bookingFallback")}
          meta={meta.join(" · ")}
          past
          imported
        />
      ),
    });
  }

  for (const { order } of diver.orders) {
    // A booking-linked order is already a fact *of* its seat's row above.
    if (order.bookingId) continue;
    entries.push({
      key: `order:${order.id}`,
      at: order.createdAt.getTime(),
      ahead: false,
      row: (
        <BookingStoryRow
          key={`order:${order.id}`}
          t={t}
          date={formatShortDate(order.createdAt, locale, shop.timezone)}
          title={order.description || t("divers.payments.shopPaymentFallback")}
          money={{
            state: ORDER_MONEY_STATE[order.status] ?? "open",
            label: `${t(ORDER_STATUS_KEYS[order.status] ?? "shared.orderStatus.open")} · ${formatMoneyCents(
              order.totalCents,
              order.currency,
              locale,
            )}`,
          }}
          href={`/shop/${shopSlug}/orders/${order.id}`}
          linkLabel={order.description || t("divers.payments.shopPaymentFallback")}
          past
        />
      ),
    });
  }

  // Soonest boat first, then back through the record. One ordering, so the eye
  // travels forwards in time exactly once.
  const ahead = entries.filter((entry) => entry.ahead).sort((a, b) => a.at - b.at);
  const behind = entries.filter((entry) => !entry.ahead).sort((a, b) => b.at - a.at);
  const shown = behind.slice(0, SHOP_HISTORY_PREVIEW_COUNT);
  const rest = behind.slice(SHOP_HISTORY_PREVIEW_COUNT);
  const invoice =
    paymentsConnected && !diver.person.deletedAt ? (
      <Link
        href={`/shop/${shopSlug}/orders/new?personId=${personId}`}
        className={buttonClass({ variant: "link", size: "sm", flush: true })}
      >
        {t("divers.story.newInvoice")}
      </Link>
    ) : null;

  return (
    <section className="mt-10" aria-labelledby="the-story">
      <GroupLabel as="h2" id="the-story" className="scroll-mt-24">
        {t("divers.story.heading")}
      </GroupLabel>
      {/* The one sentence the row markers cannot carry: what an imported line
          *is*. A seat the previous system recorded is evidence a booking
          existed, not evidence anybody got in the water (ADR
          20260725-import-prior-visits), and reading one as a dive is the
          mistake this line exists to prevent. */}
      {diver.priorVisits.length > 0 ? (
        <p className="mt-2 max-w-prose text-sm text-muted">
          {t("divers.history.importedVisitsText", { count: diver.priorVisits.length })}
        </p>
      ) : null}
      {ahead.length + shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("divers.story.empty")}</p>
      ) : (
        <ul className="mt-3">{[...ahead, ...shown].map((entry) => entry.row)}</ul>
      )}
      {rest.length > 0 ? (
        <LedgerGroup
          as="h3"
          folded
          label={t("divers.story.showAll", { count: behind.length })}
          className="mt-3"
        >
          <ul>{rest.map((entry) => entry.row)}</ul>
        </LedgerGroup>
      ) : null}
      {invoice ? <div className="mt-2">{invoice}</div> : null}
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
    </section>
  );
}
