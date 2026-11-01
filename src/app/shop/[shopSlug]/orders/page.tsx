import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
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
import {
  ImportedOrdersListPagination,
  OrdersListPagination,
} from "./_components/OrdersListPagination";
import { OrdersSeatLines } from "./_components/OrdersSeatLines";
import { OrdersToolbar } from "./_components/OrdersToolbar";
import { OwedLine } from "./_components/OwedLine";
import { MoneyOwedQueues } from "./_components/OwedMoneyQueues";
import { PaymentsSetupCard } from "./_components/PaymentsSetupCard";
import { PayoutLines, readBackOffice } from "./_components/PayoutLines";
import { type OrdersHrefOverrides, orderIndexFilter, ordersIndexHref } from "./order-index-filter";

// This page's loading.tsx can paint before its reads; no request read sits above it.
export const instant = true;

export const metadata: Metadata = { title: "Orders — DiveDay" };

/* Use concise canonical status labels here; enum-keyed copy keeps new database
 * statuses from silently appearing as raw values in the filter. */

/** Show the unfinished money operation in shop language; keep its Stripe id
 * available on demand for lookup. The fallback avoids exposing raw enum values. */
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

/** Keep refusals from creating an order on the order surface, where every staff
 * role can still read orders and find payment guidance. */
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

/** The day ledger groups orders with the date, count and currency-specific
 * subtotal in each header; imported history remains a separate disclosure. */
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
  // The destination re-checks payment setup; hiding this door avoids a dead end.
  const paymentsConnected = canAcceptPayments(await getShopStripeAccount(db, session.user.shopId));

  // Unconfirmed Stripe operations are money work and remain conspicuous here.
  //
  // Keep the DB-backed permissions separate: reconciliation is payment-manager
  // only, order creation has its own gate, and exports follow report access.
  // Unauthorized staff never trigger the privileged reconciliation read; each
  // destination also enforces its own permission.
  const [canReconcilePayments, canManageOrders, canExportOrders] = await Promise.all([
    canPersonManagePaymentSettings(db, session.user.shopId, session.user.personId),
    canPersonManageOrders(db, session.user.shopId, session.user.personId),
    canPersonViewShopReports(db, session.user.shopId, session.user.personId),
  ]);
  // Reuse one permission-gated door in both the header and empty state.
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

  // Page and CSV use the same URL filter so they describe the same orders.
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
  // Imported history has no local trip or order status: honor diver and explicit
  // date filters, omit the live-order default window, and hide it for trip views.
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

  // Resolve filter labels independently so empty results still name the filter.
  const filteredPersonName = personFilter
    ? await getShopPersonName(db, shop.id, personFilter)
    : null;
  // Shop-scope the trip lookup; an empty result still names its departure.
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
    // Format date-only ledger headers at UTC midnight in UTC to avoid shifting
    // them to the prior day in the shop's timezone.
    const date = formatShortDate(calendarDateToUtcMidnight(group.day), locale, "UTC");
    const named = group.day === today ? t("orders.index.ledger.today", { date }) : date;
    return {
      key: group.day,
      // Mark a day continued across pages; its subtotal still covers the whole day.
      label: group.continued ? t("orders.index.ledger.continued", { day: named }) : named,
      meta: t("orders.index.ledger.dayMeta", {
        count: group.count,
        // Preserve each order's stored currency if a day spans a shop currency change.
        subtotal: group.subtotals
          .map((entry) => formatMoneyCents(entry.cents, entry.currency, locale))
          .join(" · "),
      }),
      rows: group.orders.map((row) => orderLedgerRow(row, { t, locale, shopSlug })),
    };
  });

  // Avoid an empty toolbar until there are orders, history, or active filters.
  const showToolbar = hasFilters || orderPage.total > 0 || hasImportedHistory;

  return (
    <StaffPage width="full">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        title={t("shared.shopSections.money")}
        actions={
          <>
            {/* Keep one primary action when the empty state already offers it;
                payment setup belongs to the setup card below. */}
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

      {/* Keep this operational queue above filters in a bordered, danger-toned
          panel; an empty queue adds no panel. */}
      {stuckPaymentOperations.length > 0 ? (
        <section aria-label={t("orders.index.paymentOps.sectionLabel")} className="mb-6">
          <ShopNotice tone="danger" role="status">
            <p className="font-medium">
              {t("orders.index.paymentOps.heading", { count: stuckPaymentOperations.length })}
            </p>
            {/* The heading already states the action, so omit a repeated explanation. */}
            <ul className={NOTICE_ROWS}>
              {stuckPaymentOperations.map(({ intent, tripId: opTripId, tripTitle, personName }) => (
                <li key={intent.id} className="group/op">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {t(OPERATION_UNFINISHED_KEYS[intent.kind] ?? OPERATION_UNFINISHED_FALLBACK, {
                        date: formatShortDate(intent.startedAt, locale, shop.timezone),
                      })}
                    </span>
                    {/* Keep the separator with the departure so phone wrapping
                        never starts the next line with a bullet. */}
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
                  {/* Keep the Stripe lookup id one tap away and monospaced for
                      accurate transcription. The 44px target uses the notice's
                      bottom padding only on the final row; other rows keep their
                      gap, and its focus ring clears the row above. */}
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

      {/* A linked trip filter has no toolbar control, so identify the narrowed
          list here and keep a path back to its departure. */}
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
        // Offer setup or a first order when truly empty; filtered results get a clear action.
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

      <OrdersListPagination
        t={t}
        shown={days.reduce((count, day) => count + day.rows.length, 0)}
        pagination={orderPage}
        href={(target) => hrefWith({ page: target })}
      />

      {/* Export every matching page as a browser download. */}
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

      {/* Keep imported history findable as a separate collapsed record; leave it
          open while paging through it. */}
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
            {/* Keep the explanation adjacent to the imported rows it describes. */}
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
                      {/* The section badge marks all rows as unverified; the receipt
                          reference labels its document link when available. */}
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
            <ImportedOrdersListPagination
              t={t}
              shown={importedHistoryPage.rows.length}
              pagination={importedHistoryPage}
              href={(target) => hrefWith({ importedPage: target })}
            />
          </LedgerGroup>
        </section>
      ) : null}
    </StaffPage>
  );
}
