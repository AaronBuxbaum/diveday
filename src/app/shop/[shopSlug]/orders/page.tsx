import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { listImportedPaymentHistory } from "@/db/imported-payment-history";
import { ORDER_DEFAULT_RANGE_DAYS, pagedOrdersByDay } from "@/db/orders";
import { listStuckPaymentOperations } from "@/db/payment-operations";
import { getShopPersonName } from "@/db/people";
import { listOwedShopCancellationRefunds } from "@/db/refunds";
import { orderStatus } from "@/db/schema";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getShopTripTitle } from "@/db/trips";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
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
import { uuidParam } from "@/lib/uuid";
import { wallTimeToUtc } from "@/lib/zoned";
import { type OrderLedgerDay, OrdersLedger } from "./_components/OrdersLedger";
import { OrdersToolbar } from "./_components/OrdersToolbar";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
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
 * Which Stripe call an unconfirmed operation was. Without an entry here the
 * lookup falls through to the raw enum value, so a stuck operation would read
 * "checkout_session" on the panel below.
 */
const OPERATION_KIND_KEYS: Record<string, StaffMessageKey> = {
  checkout_session: "orders.index.paymentOps.kind.checkout_session",
  invoice: "orders.index.paymentOps.kind.invoice",
  refund: "orders.index.paymentOps.kind.refund",
};

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
};

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * An `?from=`/`?to=` day (shop-local, `<input type="date">` value) to a UTC
 * instant — the day's start for `from`, the *next* day's start for `to` so
 * the whole end day is included in a `[from, to)` range. Malformed or absent
 * input is simply not a filter, never a thrown error over a stray query param.
 */
function dayBoundary(
  value: string | undefined,
  timeZone: string,
  addDays: number,
): Date | undefined {
  const match = value ? DATE_INPUT.exec(value) : null;
  if (!match) return undefined;
  const [, year, month, day] = match;
  return wallTimeToUtc(
    { year: Number(year), month: Number(month), day: Number(day) + addDays, hour: 0, minute: 0 },
    timeZone,
  );
}

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
    from?: string;
    to?: string;
    range?: string;
    page?: string;
    importedPage?: string;
    notice?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { status, personId, q, tripId, from, to, range, page, importedPage, notice } =
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
  const canReconcilePayments = await canPersonManagePaymentSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  // Money the shop owes divers for departures it cancelled and could not refund
  // by card — a counter payment, a disconnected Stripe account, a refund Stripe
  // refused. The sweep that creates most of these runs hourly from a cron with
  // no human near it, and it tells every affected diver the shop will be in
  // touch; until this panel there was nothing on any screen that said so
  // (ADR 20260813-shop-cancellation-refunds-itself's own consequence).
  //
  // Same gate and same query-only-if-visible as the stuck operations above.
  const stuckPaymentOperations = canReconcilePayments
    ? await listStuckPaymentOperations(db, shop.id)
    : [];
  const owedRefunds = canReconcilePayments
    ? await listOwedShopCancellationRefunds(db, shop.id)
    : [];

  const statusFilter = orderStatus.enumValues.includes(
    status as (typeof orderStatus.enumValues)[number],
  )
    ? (status as (typeof orderStatus.enumValues)[number])
    : undefined;
  const trimmedQuery = q?.trim() || undefined;
  // Validated the way `?status=` is validated against its enum, and for the
  // reason `dayBoundary` above gives: a malformed value is simply not a filter.
  // `trips.id` and `orders.person_id` are `uuid` columns, so a stray
  // `?tripId=nope`/`?personId=nope` reaching the query is not an empty list —
  // it is a thrown `invalid input syntax for type uuid` and a 500 on a page a
  // staffer only mistyped their way onto. Both ids arrive from links other
  // pages build, and a link is exactly the thing that gets truncated in a chat
  // message. `personFilter` is used *everywhere* the raw param used to be
  // (query, hidden rider, self-links, pinned name), so a bad id leaves no
  // trace for the staffer to carry around.
  const tripFilter = uuidParam(tripId);
  const personFilter = uuidParam(personId);

  const fromBoundary = dayBoundary(from, shop.timezone, 0);
  const toBoundary = dayBoundary(to, shop.timezone, 1);
  // The index is windowed unless it is told otherwise: without one it loaded
  // every invoice a shop has ever raised. `?range=all` is the stated way out,
  // and an explicit `?from=`/`?to=` replaces the window rather than nesting
  // inside it — a staffer who asked for last March means last March.
  const hasDateBounds = Boolean(fromBoundary || toBoundary);
  // `range` is authoritative when present, and the toolbar now offers Custom
  // unconditionally: picking it submits `range=custom` with no bounds yet,
  // which filters nothing and is what puts the two date inputs on screen.
  const selectedRange =
    range === "all"
      ? "all"
      : range === "recent"
        ? "recent"
        : range === "custom" || hasDateBounds
          ? "custom"
          : "recent";
  const showAll = selectedRange === "all";
  const customRange = selectedRange === "custom";
  const windowed = selectedRange === "recent";
  const defaultFrom = windowed
    ? new Date(nowDate().getTime() - ORDER_DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
    : undefined;

  const ledger = await pagedOrdersByDay(
    db,
    shop.id,
    shop.timezone,
    {
      status: statusFilter,
      personId: personFilter,
      // The search **combines** with a pinned diver rather than yielding to
      // it, which the old diver-name box could not do: one search over the
      // name and the departure means that inside one diver's orders it still
      // has something to narrow, so the box is never a control that visibly
      // does nothing.
      q: trimmedQuery,
      // Arrives from a link, exactly like `personId` — the trip pulse's "N
      // orders are awaiting payment ›". `pagedOrdersByDay` matches it through
      // the order's booking and counts with the same joins, so the pager
      // cannot promise pages this filter renders nothing on.
      tripId: tripFilter,
      from: customRange ? fromBoundary : defaultFrom,
      to: customRange ? toBoundary : undefined,
    },
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

  /** This page's URL with the filters kept and only the given params swapped. */
  const hrefWith = (overrides: { page?: number; importedPage?: number; range?: string | null }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (personFilter) query.set("personId", personFilter);
    if (trimmedQuery) query.set("q", trimmedQuery);
    if (tripFilter) query.set("tripId", tripFilter);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const nextRange =
      overrides.range === undefined
        ? range === "all"
          ? "all"
          : range === "recent"
            ? "recent"
            : range === "custom"
              ? "custom"
              : null
        : overrides.range;
    if (nextRange) query.set("range", nextRange);
    if (overrides.page !== undefined && overrides.page > 1) {
      query.set("page", String(overrides.page));
    }
    if (overrides.importedPage !== undefined && overrides.importedPage > 1) {
      query.set("importedPage", String(overrides.importedPage));
    }
    const search = query.toString();
    return search ? `/shop/${shopSlug}/orders?${search}` : `/shop/${shopSlug}/orders`;
  };

  // Looked up rather than read off the first row — a filter that matches
  // nothing still has to say whose orders it was looking for, and the
  // row-derived name vanished on exactly the empty screen that needed the
  // explanation most.
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
        subtotal: formatMoneyCents(group.subtotalCents, shop.currency, locale),
      }),
      rows: group.orders.map((row) => {
        const amount = formatMoneyCents(row.order.totalCents, row.order.currency, locale);
        return {
          id: row.order.id,
          href: `/shop/${shopSlug}/orders/${row.order.id}`,
          // The diver and the amount, and deliberately not the date: the day
          // heading above already carries it, in the accessibility tree as
          // well as on screen (`OrdersLedger.test.tsx`).
          linkLabel: t("orders.index.ledger.rowLabel", { name: row.person.fullName, amount }),
          diver: row.person.fullName,
          detail: row.trip?.title ?? row.order.description ?? null,
          // Paid is the expected state and renders as nothing at all; only the
          // exceptional statuses earn a badge (principle 9). That is this
          // page's call, made here — `ORDER_STATUS_TONES` still knows paid is
          // `success`, because the two surfaces that do show it need that.
          status:
            row.order.status === "paid"
              ? null
              : {
                  word: ORDER_STATUS_KEYS[row.order.status]
                    ? t(ORDER_STATUS_KEYS[row.order.status])
                    : row.order.status,
                  tone: ORDER_STATUS_TONES[row.order.status] ?? "neutral",
                },
          amount,
        };
      }),
    };
  });

  // A control with nothing to govern: on a shop that has never taken an order
  // and is not filtering, the toolbar is three empty boxes above an empty
  // state that already says the one thing there is to do.
  const showToolbar = hasFilters || orderPage.total > 0 || hasImportedHistory;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("orders.index.eyebrow")}
        title={t("orders.index.title")}
        actions={
          <>
            {/* The monthly report is this page's money, summed — its door
                lives here now that Reports left the header nav (it keeps its
                palette row and gate). */}
            {canReconcilePayments ? (
              <Link
                href={`/shop/${shopSlug}/reports`}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("orders.index.monthlyReport")}
              </Link>
            ) : null}
            {/* While the unfiltered list is empty, the empty state below holds
                this same door — two identical primaries for one action is
                triage work the layout should do (principle 8), so the header
                stands down. */}
            {orderPage.total === 0 &&
            !hasImportedHistory &&
            !hasFilters ? null : paymentsConnected ? (
              <Link href={`/shop/${shopSlug}/orders/new`} className={buttonClass()}>
                {t("orders.index.newOrder")}
              </Link>
            ) : (
              <PaymentsConnectCta shopSlug={shopSlug} label={t("shared.payments.connect")} />
            )}
          </>
        }
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

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
            <p className="mt-1 text-sm">{t("orders.index.paymentOps.detail")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {stuckPaymentOperations.map(({ intent, tripId: opTripId, tripTitle, personName }) => (
                <li key={intent.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{t(OPERATION_KIND_KEYS[intent.kind])}</span>
                  {tripTitle ? <span>· {tripTitle}</span> : null}
                  {personName ? <span>· {personName}</span> : null}
                  <span className="text-muted">
                    ·{" "}
                    {t("orders.index.paymentOps.started", {
                      date: formatShortDate(intent.startedAt, locale, shop.timezone),
                    })}
                    {intent.stripeObjectId
                      ? ` · ${t("orders.index.paymentOps.stripeId", { id: intent.stripeObjectId })}`
                      : ""}
                  </span>
                  {opTripId ? (
                    <Link
                      href={`/shop/${shopSlug}/trips/${opTripId}/guests`}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      {t("orders.index.paymentOps.openTrip")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

      {/* Renders nothing when nothing is owed — a queue, not a heading that
          sits on the page announcing its own emptiness. Warning rather than
          danger: nothing is broken, somebody is just owed money. */}
      {owedRefunds.length > 0 ? (
        <section aria-label={t("orders.index.owedRefunds.sectionLabel")} className="mb-6">
          <ShopNotice tone="warning" role="status">
            <p className="font-medium">
              {t("orders.index.owedRefunds.heading", { count: owedRefunds.length })}
            </p>
            <p className="mt-1 text-sm">{t("orders.index.owedRefunds.detail")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {owedRefunds.map((owed) => (
                <li key={owed.bookingId} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{owed.diverName}</span>
                  <span>· {owed.tripTitle}</span>
                  <span className="text-muted">
                    ·{" "}
                    {/* A counter mark often records no amount. Saying so beats
                        printing a confident 0.00 the shop would have to
                        distrust. */}
                    {owed.amountCents === null
                      ? t("orders.index.owedRefunds.unrecordedAmount")
                      : formatMoneyCents(owed.amountCents, owed.currency, locale)}
                    {owed.depositOnly ? ` · ${t("orders.index.owedRefunds.depositOnly")}` : ""}
                    {" · "}
                    {formatShortDate(owed.tripStartsAt, locale, shop.timezone)}
                  </span>
                  <Link
                    href={`/shop/${shopSlug}/trips/${owed.tripId}/guests`}
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    {t("orders.index.owedRefunds.openTrip")}
                  </Link>
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

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

      {days.length === 0 && (hasFilters || !hasImportedHistory) ? (
        // The same fork the header makes (Loop 3): with no orders on file the
        // one thing that moves a shop forward is either sending the first one
        // or connecting the account that can. Filtered-to-nothing is a
        // different problem and gets the way back out instead.
        <EmptyState
          title={
            hasFilters
              ? t("orders.index.emptyFiltered")
              : paymentsConnected
                ? t("orders.index.emptyAll")
                : t("orders.index.emptyNoPayments")
          }
          action={
            hasFilters ? (
              <Link
                href={clearHref}
                scroll={false}
                className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
              >
                {t("orders.index.filters.clear")}
              </Link>
            ) : paymentsConnected ? (
              <Link
                href={`/shop/${shopSlug}/orders/new`}
                className={buttonClass({ className: "mt-4" })}
              >
                {t("orders.index.newOrder")}
              </Link>
            ) : (
              <PaymentsConnectCta
                shopSlug={shopSlug}
                label={t("shared.payments.connect")}
                className="mt-4"
              />
            )
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
        t={t}
        className="mt-8"
      />

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
              t={t}
              className="mt-4"
            />
          </LedgerGroup>
        </section>
      ) : null}
    </main>
  );
}
