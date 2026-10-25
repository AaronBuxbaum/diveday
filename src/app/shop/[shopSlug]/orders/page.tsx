import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { Badge } from "@/components/ui/badge";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { canPersonManageOrders, canPersonManagePaymentSettings } from "@/db/authz";
import { listImportedPaymentHistory } from "@/db/imported-payment-history";
import { ORDER_DEFAULT_RANGE_DAYS, pagedOrdersByDay } from "@/db/orders";
import { getShopPersonName } from "@/db/people";
import { canPersonViewShopReports } from "@/db/reporting";
import { orderStatus } from "@/db/schema";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getShopTripTitle } from "@/db/trips";
import { ORDER_STATUS_KEYS } from "@/i18n/order-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import {
  calendarDateInTimezone,
  calendarDateToUtcMidnight,
  formatCalendarDate,
  isValidCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { isManagedStorageUrl } from "@/lib/storage/blob-host";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { orderLedgerRow } from "./_components/ledger-row";
import {
  FACT_SEPARATOR,
  NOTICE_ROWS,
  OPEN_TRIP_LINE,
  OPEN_TRIP_LINK,
} from "./_components/notice-rows";
import { type OrderLedgerDay, OrdersLedger } from "./_components/OrdersLedger";
import { OrdersSeatLines } from "./_components/OrdersSeatLines";
import { OrdersToolbar } from "./_components/OrdersToolbar";
import { OwedLine } from "./_components/OwedLine";
import { MoneyOwedQueues } from "./_components/OwedMoneyQueues";
import { PaymentsSetupCard } from "./_components/PaymentsSetupCard";
import { PayoutLines, readBackOffice } from "./_components/PayoutLines";
import { type OrdersHrefOverrides, orderIndexFilter, ordersIndexHref } from "./order-index-filter";

// `instant = true` asserts that navigating *into* this page paints immediately — this segment's
// `loading.tsx`, with no request read above it. Since the staff shell became synchronous (issue
// 1446) that holds for a cold, direct visit too: the shell's session, shop row and nav stream in
// beside the page from `ShopChrome` rather than above it, so the route gets a static shell and its
// own reads are the only ones the reader waits on. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Orders — DiveDay" };

/*
 * **The index reads the canonical status words** (`ORDER_STATUS_KEYS`), not the
 * order *detail* page's longer phrasing, which is what it used to import.
 *
 * On a page with room for a sentence, "Open — awaiting payment" is a helpful
 * gloss. On a ledger row it is three words wrapping inside a `rounded-full`
 * pill, beside rows whose whole status is one word. The word is "Open"; what
 * it means is what the order record is for.
 *
 * `ORDER_STATUS_KEYS` keeps the property the local copy existed for: it is
 * keyed by the enum, not by `string`, and the filter below maps over
 * `orderStatus.enumValues` — so a status added to the column is a compile error
 * rather than a dropdown option rendering the raw database value, which is
 * exactly what happened when `partly_refunded` arrived (issue #699).
 */

/**
 * **What happened, as a sentence — not the enum and not the object id.**
 *
 * The panel's rows read "Checkout · … · started Jul 21 · Stripe: cs_e2e_stuck"
 * under a paragraph explaining that "Stripe was asked to do something and the
 * app never confirmed how it went". Between them that is a database enum, an
 * internal identifier and the mechanism, on a surface a shop owner opens to
 * find out what they owe somebody (principle 4 — never surface the
 * implementation). The row says what happened to whose money instead; the id is
 * still here, one tap down, because it is what a shop types into Stripe's own
 * search box.
 *
 * Keyed by the enum so a kind added to the column is a compile-time hole rather
 * than a row rendering `checkout_session`; `OPERATION_UNFINISHED_FALLBACK`
 * catches one that arrives anyway.
 */
const OPERATION_UNFINISHED_KEYS: Record<string, StaffMessageKey> = {
  checkout_session: "orders.index.paymentOps.unfinished.checkout_session",
  invoice: "orders.index.paymentOps.unfinished.invoice",
  refund: "orders.index.paymentOps.unfinished.refund",
};
const OPERATION_UNFINISHED_FALLBACK: StaffMessageKey = "orders.index.paymentOps.unfinished.other";

const IMPORTED_PAYMENT_DIRECTION_KEYS: Record<"payment" | "refund" | "unknown", StaffMessageKey> = {
  payment: "orders.index.importedHistory.direction.payment",
  refund: "orders.index.importedHistory.direction.refund",
  unknown: "orders.index.importedHistory.direction.unknown",
};

/** A source URL is rendered only after import re-stored it, or when it is a same-origin legacy path. */
function safeImportedDocumentUrl(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("/") || isManagedStorageUrl(url) ? url : null;
}

/**
 * Where `orders/new` lands a staffer it turned away — for having no connected
 * account and no diver in hand, or for not being an owner/manager (H-14) — this
 * index, the surface that door belongs to, rather than `/divers`, which has
 * nothing to say about payments. Reading orders stays open to every staff role;
 * only raising one is gated, so this is a page they can still use.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "payment-not-connected": { tone: "warning", key: "orders.index.notice.paymentNotConnected" },
  "not-authorized": { tone: "danger", key: "orders.index.notice.notAuthorized" },
  "not-authorized-refund": { tone: "danger", key: "orders.index.notice.notAuthorizedRefund" },
  "paid-after-close-refunded": {
    tone: "success",
    key: "orders.index.notice.paidAfterCloseRefunded",
  },
  "paid-after-close-in-progress": {
    tone: "neutral",
    key: "orders.index.notice.paidAfterCloseInProgress",
  },
  "paid-after-close-needs-check": {
    tone: "warning",
    key: "orders.index.notice.paidAfterCloseNeedsCheck",
  },
  "paid-after-close-not-connected": {
    tone: "warning",
    key: "orders.index.notice.paidAfterCloseNotConnected",
  },
  "paid-after-close-failed": { tone: "danger", key: "orders.index.notice.paidAfterCloseFailed" },
  "stripe-refund-matched": { tone: "success", key: "orders.index.notice.stripeRefundMatched" },
  "stripe-refund-partly-matched": {
    tone: "neutral",
    key: "orders.index.notice.stripeRefundPartlyMatched",
  },
  "stripe-refund-not-matched": {
    tone: "warning",
    key: "orders.index.notice.stripeRefundNotMatched",
  },
};

/**
 * **The shop's money as a day ledger** — ADR
 * 20260827-clearwater-surface-language, decision 7.
 *
 * Every order the shop has ever sent, grouped into the days it took them: the
 * day header owns the date, the count and the subtotal, and a row is a diver,
 * what they bought, and an amount. The five-control filter card that used to
 * stand above it is a toolbar; the imported payment history that used to stand
 * beside it as a second table and a second pager is one disclosure row at the
 * foot. Reports' revenue rows, the roster's payment cells, the command palette,
 * and Settings' Money group all link in here.
 */
export default async function OrdersIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    status?: string;
    personId?: string;
    /** The toolbar's one search box — diver name, departure title, order note. */
    q?: string;
    /** One departure's orders — the trip pulse's awaiting-payment fact links here. */
    tripId?: string;
    seats?: string;
    from?: string;
    to?: string;
    range?: string;
    page?: string;
    importedPage?: string;
    notice?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { status, personId, q, tripId, seats, from, to, range, page, importedPage, notice } =
    await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const banner = noticeFromParam(notice, NOTICES);
  // Hiding the New order button when there's no account to invoice from is a
  // courtesy — `orders/new` re-checks and refuses regardless. What it buys is
  // that a day-one shop's Orders index offers the one thing that actually
  // moves them forward instead of a button that bounces them right back here.
  const paymentsConnected = canAcceptPayments(await getShopStripeAccount(db, session.user.shopId));

  // Stripe operations the app started and never saw finish — money that may or
  // may not have moved. They used to hang off the bottom of the monthly report,
  // which is a page about how the month *went*, not a queue; reconciling an
  // unconfirmed charge is order work, so it lives on the order surface now.
  //
  // Read behind `canPersonManagePaymentSettings` — the identical owner/manager
  // role set (`isOwnerOrManager`) that the reports gate it left was built from,
  // so exactly the same people see it, checked against the database rather than
  // the JWT. Reading orders itself stays open to every staff role; this panel
  // does not, and the query does not even run for the roles that can't see it.
  //
  // `canManageOrders` is read for itself, never borrowed from the line above:
  // the two predicates agree today and are separate on purpose (ADR
  // 20260803-invoicing-role-gate). It hides the two "New order" doors from a
  // reader `orders/new` would only bounce back here (issue #1925) — a
  // courtesy, never the gate; the route, its action and `createOrder` each
  // refuse on their own.
  // `canExportOrders` is the Reports CSV's gate, for the same reason: a file
  // of every filtered order with diver names is the owner's or manager's to
  // take away, and `orders/download` refuses everyone else on its own.
  const [canReconcilePayments, canManageOrders, canExportOrders] = await Promise.all([
    canPersonManagePaymentSettings(db, session.user.shopId, session.user.personId),
    canPersonManageOrders(db, session.user.shopId, session.user.personId),
    canPersonViewShopReports(db, session.user.shopId, session.user.personId),
  ]);
  // The one "New order" door, drawn in the header and the empty state alike:
  // absent for a reader `orders/new` would refuse (issue #1925).
  const newOrderDoor = canManageOrders ? (
    <Link href={`/shop/${shopSlug}/orders/new`} className={buttonClass()}>
      {t("orders.index.newOrder")}
    </Link>
  ) : null;
  const { stuckPaymentOperations, payouts, ...queues } = await readBackOffice(
    db,
    shop,
    canReconcilePayments,
  );

  // One reading of the URL, shared with "Download orders (CSV)" so the file
  // holds the orders this page shows (`orderIndexFilter`).
  const {
    filter: orderFilter,
    range: selectedRange,
    status: statusFilter,
    query: trimmedQuery,
    tripId: tripFilter,
    personId: personFilter,
    seats: seatsFilter,
  } = orderIndexFilter(
    { status, personId, q, tripId, seats, from, to, range },
    shop.timezone,
    nowDate(),
  );
  const showAll = selectedRange === "all";
  const customRange = selectedRange === "custom";

  const ledger = await pagedOrdersByDay(
    db,
    shop.id,
    shop.timezone,
    orderFilter,
    // A non-numeric or missing `?page=` reads as page 1 rather than NaN;
    // `offsetPage` clamps it into range either way.
    { page: Number.parseInt(page ?? "", 10) },
  );
  const orderPage = ledger.page;
  // Imported source history has no local trip/order status to filter against.
  // It does follow the diver filter and an explicitly chosen calendar range,
  // but it is deliberately not trapped in the live Orders page's default
  // 90-day window — a migration's oldest receipt must stay findable. A trip
  // filter means "only records tied to this live departure", which imported
  // history cannot honestly claim, so that narrow view renders no history.
  const importedHistoryPage = tripFilter
    ? null
    : await listImportedPaymentHistory(
        db,
        shop.id,
        {
          personId: personFilter,
          // The one search box reaches the diver's name here too. Imported
          // records carry no departure, so the trip half of the search simply
          // has nothing to match — the same honest narrowing `?tripId=` gets.
          personQuery: personFilter ? undefined : trimmedQuery,
          from: customRange && from && isValidCalendarDate(from) ? from : undefined,
          to: customRange && to && isValidCalendarDate(to) ? to : undefined,
        },
        { page: Number.parseInt(importedPage ?? "", 10) },
      );
  const hasImportedHistory = Boolean(importedHistoryPage && importedHistoryPage.total > 0);

  const hrefWith = (overrides: OrdersHrefOverrides, path = "orders") =>
    ordersIndexHref(
      shopSlug,
      {
        status,
        personId: personFilter,
        q: trimmedQuery,
        tripId: tripFilter,
        seats: seatsFilter,
        from,
        to,
        range,
      },
      overrides,
      path,
    );

  // Looked up rather than read off the first row: a filter that matches
  // nothing still has to say whose orders it was looking for.
  const filteredPersonName = personFilter
    ? await getShopPersonName(db, shop.id, personFilter)
    : null;
  // Same reason, same shape: shop-scoped so another tenant's `?tripId=` names
  // nothing, and looked up so a departure with no open orders left still says
  // which departure the empty screen is about.
  const filteredTripTitle = tripFilter ? await getShopTripTitle(db, shop.id, tripFilter) : null;
  const hasFilters = Boolean(
    statusFilter ||
      personFilter ||
      trimmedQuery ||
      tripFilter ||
      from ||
      to ||
      showAll ||
      customRange ||
      range === "recent",
  );
  const clearHref = `/shop/${shopSlug}/orders`;

  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  const days: OrderLedgerDay[] = ledger.groups.map((group) => {
    // A calendar day has no instant in it, so it is formatted from its own
    // UTC midnight in UTC — running a date-only value through the shop's zone
    // is what shifts a header onto the day before the rows it names.
    const date = formatShortDate(calendarDateToUtcMidnight(group.day), locale, "UTC");
    const named = group.day === today ? t("orders.index.ledger.today", { date }) : date;
    return {
      key: group.day,
      // A day cut in half by the page boundary restates its header rather than
      // starting mid-list under nothing, and says so — the subtotal beside it
      // is the whole day's, and a reader must not read it as new money.
      label: group.continued ? t("orders.index.ledger.continued", { day: named }) : named,
      meta: t("orders.index.ledger.dayMeta", {
        count: group.count,
        // One figure per currency the day's orders were charged in, each in
        // its own. Almost always one; two only for a day that straddles a
        // change of `shops.currency`, where a single figure in the *current*
        // setting would re-price what was charged in the old one.
        subtotal: group.subtotals
          .map((entry) => formatMoneyCents(entry.cents, entry.currency, locale))
          .join(" · "),
      }),
      rows: group.orders.map((row) => orderLedgerRow(row, { t, locale, shopSlug })),
    };
  });

  // A control with nothing to govern: on a shop that has never taken an order
  // and is not filtering, the toolbar is three empty boxes above an empty
  // state that already says the one thing there is to do.
  const showToolbar = hasFilters || orderPage.total > 0 || hasImportedHistory;

  return (
    <StaffPage width="full">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        title={t("shared.shopSections.money")}
        actions={
          <>
            {/* While the unfiltered list is empty, the empty state below holds
                this same door — two identical primaries for one action is
                triage work the layout should do (principle 8), so the header
                stands down. */}
            {/* Without an account there is no order to send, and connecting
                one is the setup card's below, never this header's. */}
            {!paymentsConnected || (orderPage.total === 0 && !hasImportedHistory && !hasFilters)
              ? null
              : newOrderDoor}
          </>
        }
      />
      <StaffSectionTabs
        section="money"
        current="orders"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      {!paymentsConnected && canReconcilePayments && !shop.isDemo ? (
        <PaymentsSetupCard
          shopSlug={shopSlug}
          title={t("orders.index.setupCard.title")}
          body={t("orders.index.setupCard.body")}
          connectLabel={t("shared.payments.connect")}
        />
      ) : null}

      {/* Above the toolbar because it is not something you filter for, and
          danger-toned rather than folded away: unconfirmed money is a financial
          obligation, not a notification to dismiss. An empty queue renders
          nothing at all — the calm state of this page is no panel. A
          tone-carrying operational panel is one of the three jobs the bordered
          card keeps (ADR 20260827-clearwater-surface-language, decision 2). */}
      {stuckPaymentOperations.length > 0 ? (
        <section aria-label={t("orders.index.paymentOps.sectionLabel")} className="mb-6">
          <ShopNotice tone="danger" role="status">
            <p className="font-medium">
              {t("orders.index.paymentOps.heading", { count: stuckPaymentOperations.length })}
            </p>
            {/* No second paragraph under the heading: it explained the
                mechanism ("Stripe was asked to do something and the app never
                confirmed how it went"), and the heading above already says what
                to do about it. */}
            <ul className={NOTICE_ROWS}>
              {stuckPaymentOperations.map(({ intent, tripId: opTripId, tripTitle, personName }) => (
                <li key={intent.id} className="group/op">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {t(OPERATION_UNFINISHED_KEYS[intent.kind] ?? OPERATION_UNFINISHED_FALLBACK, {
                        date: formatShortDate(intent.startedAt, locale, shop.timezone),
                      })}
                    </span>
                    {/* Whose money and which boat, joined here rather than
                        each carrying its own separator — a row with a name and
                        no departure used to open on a stray bullet — with the
                        dot bound to the departure, so a phone's line never
                        opens on "· Priya Sharma" (K-569). */}
                    {tripTitle || personName ? (
                      <span>{[tripTitle, personName].filter(Boolean).join(FACT_SEPARATOR)}</span>
                    ) : null}
                    {opTripId ? (
                      <span className={OPEN_TRIP_LINE}>
                        <Link
                          href={`/shop/${shopSlug}/trips/${opTripId}`}
                          className={OPEN_TRIP_LINK}
                        >
                          {t("orders.index.paymentOps.openTrip")}
                        </Link>
                      </span>
                    ) : null}
                  </p>
                  {/* The identifier a shop pastes into Stripe's own search, one
                      tap down rather than on the row's face. Mono, because it is
                      a string to be transcribed character for character. */}
                  {/* **On the last row, the target's spare height hangs
                      below the words, into the notice's padding** (K-388). The
                      summary is a 44px box round a 16px line, and the 14px
                      under the words stood on the notice's `py-3`: 13px from
                      the border to the heading's ink, 27px from "Stripe
                      reference" to the border. `-mb-3.5` gives those 14px back
                      there, so the words end on the content edge and the
                      padding is 13 and 13; the box spills into the padding,
                      which nothing clips. Only on the last row (the row is
                      `group/op`): on any other, the margin would collapse into
                      the gap below it and pull the next row up under the
                      reference, which would then read as that row's. And only
                      the bottom: a box lifted 14px would put its ring across
                      the row's first line. `flex w-fit` rather than
                      `inline-flex`, so the margin is taken whole; an inline
                      box's line keeps the strut of the row's `text-sm` under
                      it. Open, the id starts 4px under the box on every row:
                      `mt-1`, or 14 + 4 where the box has bled. */}
                  {intent.stripeObjectId ? (
                    <details className="mt-1">
                      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center text-xs text-muted underline underline-offset-2 group-last/op:-mb-3.5 [&::-webkit-details-marker]:hidden">
                        {t("orders.index.paymentOps.reference")}
                      </summary>
                      <code className="mt-1 block font-mono text-xs break-all text-muted group-last/op:mt-4.5">
                        {intent.stripeObjectId}
                      </code>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

      <MoneyOwedQueues
        queues={queues}
        shopSlug={shopSlug}
        timeZone={shop.timezone}
        locale={locale}
        t={t}
      />

      <PayoutLines payouts={payouts} locale={locale} timeZone={shop.timezone} t={t} />
      {canExportOrders ? <OwedLine db={db} shop={shop} locale={locale} t={t} /> : null}

      {showToolbar ? (
        <OrdersToolbar
          q={trimmedQuery ?? ""}
          status={statusFilter ?? ""}
          range={selectedRange}
          from={from ?? ""}
          to={to ?? ""}
          personId={personFilter}
          tripId={tripFilter}
          clearHref={hasFilters ? clearHref : undefined}
          copy={{
            searchLabel: t("orders.index.filters.searchLabel"),
            searchPlaceholder: t("orders.index.filters.searchPlaceholder"),
            statusLabel: t("orders.index.filters.statusLabel"),
            statusAll: t("orders.index.filters.statusAll"),
            statuses: orderStatus.enumValues.map((value) => ({
              value,
              label: ORDER_STATUS_KEYS[value] ? t(ORDER_STATUS_KEYS[value]) : value,
            })),
            rangeLabel: t("orders.index.filters.rangeLabel"),
            rangeRecent: t("orders.index.filters.rangeRecent", { days: ORDER_DEFAULT_RANGE_DAYS }),
            rangeAll: t("orders.index.filters.rangeAll"),
            rangeCustom: t("orders.index.filters.rangeCustom"),
            fromLabel: t("orders.index.filters.fromLabel"),
            toLabel: t("orders.index.filters.toLabel"),
            clear: t("orders.index.filters.clear"),
            count: t("orders.index.pagination.total", { count: orderPage.total }),
          }}
        />
      ) : null}

      {personFilter && filteredPersonName ? (
        <p className="mt-4 text-sm text-muted">
          {t("orders.index.filteredByDiver", { name: filteredPersonName })}
        </p>
      ) : null}

      {/* The departure is not a control in the toolbar — it is a filter that
          arrives from a link — so this line is the only thing on screen that
          says the list is narrowed to one boat, and the only way back to the
          boat itself. Dropping the filter is "Clear filters", as it is for
          every other one. */}
      {tripFilter && filteredTripTitle ? (
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
          <span>{t("orders.index.filteredByTrip", { title: filteredTripTitle })}</span>
          <Link
            href={`/shop/${shopSlug}/trips/${tripFilter}`}
            className="font-medium text-primary hover:underline"
          >
            {t("orders.index.openFilteredTrip")}
          </Link>
        </p>
      ) : null}

      <OrdersSeatLines
        db={db}
        shopId={shop.id}
        filter={orderFilter}
        seats={seatsFilter}
        hrefFor={(seats) => hrefWith({ seats })}
        t={t}
      />

      {days.length === 0 && (hasFilters || !hasImportedHistory) ? (
        // The same fork the header makes (Loop 3): with no orders on file the
        // one thing that moves a shop forward is either sending the first one
        // or connecting the account that can. Filtered-to-nothing is a
        // different problem and gets the way back out instead.
        <EmptyState
          title={hasFilters ? t("orders.index.emptyFiltered") : t("orders.index.emptyAll")}
          action={
            hasFilters ? (
              <Link
                href={clearHref}
                scroll={false}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("orders.index.filters.clear")}
              </Link>
            ) : paymentsConnected ? (
              newOrderDoor
            ) : null
          }
          className="mt-8"
        />
      ) : days.length > 0 ? (
        <OrdersLedger days={days} className="mt-8" />
      ) : null}

      {/* No `total` here: the toolbar already states how many orders the filter
          found, and a shared fact said twice on one screen is the repetition
          this recomposition is about. */}
      <Pager
        page={orderPage.page}
        pageCount={orderPage.pageCount}
        href={(target) => hrefWith({ page: target })}
        words={staffPagerWords(t)}
      />

      {/* **The ledger as a bookkeeper's file** (third UX review, item 34): every
          order this filter found, across every page, one row per line. A plain
          anchor, as Reports' download is, so the browser saves the file rather
          than the router fetching it. */}
      {canExportOrders && days.length > 0 ? (
        <p className="mt-2 text-end text-sm print:hidden">
          <a
            href={hrefWith({}, "orders/download")}
            className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
          >
            {t("orders.index.downloadCsv")}
          </a>
        </p>
      ) : null}

      {/* One disclosure row at the foot, where a second full table and a second
          pager used to stand permanently open (decision 7). It is history from
          another system: worth keeping findable, never worth a third of the
          money screen. Open already when a reader has paged into it, so paging
          does not fold it back up. */}
      {hasImportedHistory && importedHistoryPage ? (
        <section aria-label={t("orders.index.importedHistory.sectionLabel")} className="mt-10">
          <LedgerGroup
            as="h2"
            label={t("orders.index.importedHistory.heading")}
            folded={!importedPage}
            meta={
              <span className="inline-flex items-center gap-2">
                {t("orders.index.importedHistory.pagination.total", {
                  count: importedHistoryPage.total,
                })}
                <Badge tone="neutral" size="sm">
                  {t("orders.index.importedHistory.unverified")}
                </Badge>
              </span>
            }
          >
            {/* The explanation opens with the rows it is about, rather than
                standing on the page above them. */}
            <p className="mt-2 max-w-3xl text-sm text-muted">
              {t("orders.index.importedHistory.detail")}
            </p>
            <Table shellClassName="mt-4">
              <THead>
                <Th>{t("orders.index.table.diver")}</Th>
                <Th hideBelow="sm">{t("orders.index.importedHistory.table.source")}</Th>
                <Th hideBelow="sm">{t("orders.index.importedHistory.table.status")}</Th>
                <Th>{t("orders.index.table.date")}</Th>
                <Th numeric>{t("orders.index.table.amount")}</Th>
              </THead>
              <TBody>
                {importedHistoryPage.rows.map(({ history, person }) => {
                  const receiptDocumentUrl = safeImportedDocumentUrl(history.receiptDocumentUrl);
                  return (
                    <Tr key={history.id}>
                      <Td align="middle">
                        <RowLink
                          href={`/shop/${shopSlug}/divers/${person.id}`}
                          className="text-base font-medium text-foreground hover:text-primary hover:underline sm:text-sm"
                        >
                          {person.fullName}
                        </RowLink>
                        <div className="mt-1 text-base text-muted sm:hidden">
                          {history.title ?? history.sourceReference ?? "—"}
                        </div>
                      </Td>
                      {/* Three things, where there were five.
                          `Unverified import` was on every row of this table and
                          again under every diver's name on a phone — a badge
                          stating the one fact the disclosure's own badge
                          already states about all of it, repeated once per row
                          down a warning-toned column. And the receipt was two
                          items, a reference and a link to the same document;
                          they are now one link wearing the reference as its
                          name, so a row carrying every field is a title, a
                          source, and a receipt rather than a paragraph. */}
                      <Td muted hideBelow="sm" align="middle">
                        <div className="text-base sm:text-sm">
                          {history.title ?? history.sourceReference ?? "—"}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          {history.sourceLabel ? <span>{history.sourceLabel}</span> : null}
                          {receiptDocumentUrl ? (
                            <a
                              href={receiptDocumentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-primary underline underline-offset-2"
                            >
                              {history.receiptReference
                                ? t("orders.index.importedHistory.receiptReference", {
                                    reference: history.receiptReference,
                                  })
                                : t("orders.index.importedHistory.openReceipt")}
                            </a>
                          ) : history.receiptReference ? (
                            <span>
                              {t("orders.index.importedHistory.receiptReference", {
                                reference: history.receiptReference,
                              })}
                            </span>
                          ) : null}
                        </div>
                      </Td>
                      <Td hideBelow="sm" align="middle">
                        <div>{t(IMPORTED_PAYMENT_DIRECTION_KEYS[history.direction])}</div>
                        {history.statusLabel ? (
                          <div className="mt-1 text-xs text-muted">{history.statusLabel}</div>
                        ) : null}
                        {history.stripeReference ? (
                          <div className="mt-1 text-xs text-muted">
                            {t("orders.index.importedHistory.stripeReference", {
                              reference: history.stripeReference,
                            })}
                          </div>
                        ) : null}
                      </Td>
                      <Td muted align="middle" className="whitespace-nowrap tabular-nums">
                        {formatCalendarDate(history.occurredOn, locale)}
                      </Td>
                      <Td numeric align="middle" className="text-base sm:text-sm">
                        {history.amountLabel ?? t("orders.index.importedHistory.amountNotProvided")}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            <Pager
              page={importedHistoryPage.page}
              pageCount={importedHistoryPage.pageCount}
              href={(target) => hrefWith({ importedPage: target })}
              words={staffPagerWords(t)}
            />
          </LedgerGroup>
        </section>
      ) : null}
    </StaffPage>
  );
}
