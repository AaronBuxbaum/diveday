import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { Badge } from "@/components/ui/badge";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import { ShopNotice } from "@/components/ui/outcome";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { getOrdersIndex, ORDER_DEFAULT_RANGE_DAYS, ORDER_STATUSES } from "@/features/orders-index";
import { requireShopSurface } from "@/features/session";
import { ORDER_STATUS_KEYS } from "@/i18n/order-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { noticeFromParam } from "@/lib/staff-notices";
import { isManagedStorageUrl } from "@/lib/storage/blob-host";
import { StaffListPagination } from "../_components/StaffListPagination";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { newOrderDoorFor, OrdersAddPanel } from "./_components/NewOrderPanel";
import {
  FACT_SEPARATOR,
  NOTICE_ROWS,
  OPEN_TRIP_LINE,
  OPEN_TRIP_LINK,
} from "./_components/notice-rows";
import { InvoiceDoor, OrdersHeader } from "./_components/OrdersHeader";
import { OrdersLedger } from "./_components/OrdersLedger";
import { OrdersSeatLines } from "./_components/OrdersSeatLines";
import { OrdersToolbar } from "./_components/OrdersToolbar";
import { OwedLine } from "./_components/OwedLine";
import { MoneyOwedQueues } from "./_components/OwedMoneyQueues";
import { PaymentsSetupCard } from "./_components/PaymentsSetupCard";
import { PayoutLines } from "./_components/PayoutLines";
import { PurchasePanel } from "./_components/PurchasePanel";
import { RecordedPurchaseDaySummary } from "./_components/RecordedPurchaseDaySummary";
import { orderLedgerDays } from "./_lib/order-ledger-days";
import { ORDERS_INDEX_NOTICES as NOTICES } from "./_lib/orders-index-notices";
import type { OrdersSearch } from "./_lib/orders-search";
import { type OrdersHrefOverrides, orderIndexFilter, ordersIndexHref } from "./order-index-filter";

export const instant = true;

export const metadata: Metadata = { title: "Orders — DiveDay" };

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

/** The day ledger groups orders with the date, count and currency-specific
 * subtotal in each header; imported history remains a separate disclosure. */
export default async function OrdersIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<OrdersSearch>;
}) {
  const { shopSlug } = await params;
  const search = await searchParams;
  const { status, personId, q, tripId, seats, from, to, range, page, importedPage, notice } =
    search;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
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

  // DB-backed permissions gate each reconciliation, creation and export read.
  const {
    paymentsConnected,
    can,
    backOffice: { stuckPaymentOperations, payouts, ...queues },
    ledger,
    importedHistoryPage,
    filteredPersonName,
    filteredTripTitle,
    purchaseDay,
  } = await getOrdersIndex(db, shop, session.user.personId, {
    filter: orderFilter,
    receiptDay: search.receiptDay,
    page: Number.parseInt(page ?? "", 10),
    // Imported history has no local trip or order status: honor diver and explicit
    // date filters, omit the live-order default window, and hide it for trip views.
    imported: tripFilter
      ? null
      : {
          filter: {
            personId: personFilter,
            // The one search box reaches the diver's name here too. Imported
            // records carry no departure, so the trip half of the search simply
            // has nothing to match — the same honest narrowing `?tripId=` gets.
            personQuery: personFilter ? undefined : trimmedQuery,
            from: customRange && from && isValidCalendarDate(from) ? from : undefined,
            to: customRange && to && isValidCalendarDate(to) ? to : undefined,
          },
          page: Number.parseInt(importedPage ?? "", 10),
        },
    personFilter,
    tripFilter,
  });
  const canReconcilePayments = can.reconcilePayments;
  const canExportOrders = can.exportOrders;
  const door = newOrderDoorFor(shopSlug, search.add, can.manageOrders, paymentsConnected);
  const banner = door.adding ? null : noticeFromParam(door.refusal ?? notice, NOTICES);
  // Reuse one permission-gated door in both the header and empty state.
  const newOrderDoor = door.href && <InvoiceDoor href={door.href} t={t} />;
  const orderPage = ledger.page;
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

  const hasFilters = [
    statusFilter,
    personFilter,
    trimmedQuery,
    tripFilter,
    from,
    to,
    showAll,
    customRange,
    range === "recent",
  ].some(Boolean);
  const clearHref = `/shop/${shopSlug}/orders`;

  const days = orderLedgerDays(ledger.groups, { timezone: shop.timezone, locale, t, shopSlug });

  // Avoid an empty toolbar until there are orders, history, or active filters.
  const showToolbar = hasFilters || orderPage.total > 0 || hasImportedHistory;

  return (
    <StaffPage width="full">
      <FlashParams params={["notice"]} />
      <OrdersHeader
        {...{ shopSlug, t, search }}
        showInvoice={paymentsConnected && !!door.href && showToolbar}
        invoiceDoor={newOrderDoor}
      />
      <StaffSectionTabs
        section="money"
        current="orders"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}
      <RecordedPurchaseDaySummary
        data={purchaseDay}
        search={search}
        shopSlug={shopSlug}
        locale={locale}
        t={t}
      />
      <PurchasePanel
        open={search.purchase === "1"}
        surface={{ db, shop, session }}
        search={search}
        {...{ t, locale }}
        personId={personFilter}
      />
      <OrdersAddPanel
        open={door.adding && search.purchase !== "1"}
        {...{ surface: { db, shop, session }, shopSlug, search, t, locale }}
      />

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
          <ShopNotice tone="danger" role="status" persistent>
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
            statuses: ORDER_STATUSES.map((value) => ({
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

      <StaffListPagination
        t={t}
        pagination={orderPage}
        href={(target) => hrefWith({ page: target })}
      />

      {/* Export every matching page as a browser download. */}
      {canExportOrders && days.length > 0 ? (
        <p className="mt-2 text-end text-sm">
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
                {/* Below `sm` the date folds under the name with the title, so
                    the diver keeps the row's width instead of a third of it
                    ("Hana / Kobayashi / Two-tank / morning", `orders-imported-history-open`). */}
                <Th hideBelow="sm">{t("orders.index.table.date")}</Th>
                <Th numeric width="8rem">
                  {t("orders.index.table.amount")}
                </Th>
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
                        <div className="mt-0.5 text-sm text-muted tabular-nums sm:hidden">
                          {formatCalendarDate(history.occurredOn, locale)}
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
                      <Td
                        muted
                        hideBelow="sm"
                        align="middle"
                        className="whitespace-nowrap tabular-nums"
                      >
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
            <StaffListPagination
              t={t}
              pagination={importedHistoryPage}
              href={(target) => hrefWith({ importedPage: target })}
            />
          </LedgerGroup>
        </section>
      ) : null}
    </StaffPage>
  );
}
