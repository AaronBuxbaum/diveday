import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { listShopOrders, ORDER_DEFAULT_RANGE_DAYS } from "@/db/orders";
import { listStuckPaymentOperations } from "@/db/payment-operations";
import { getShopPersonName } from "@/db/people";
import { listOwedShopCancellationRefunds } from "@/db/refunds";
import { orderStatus } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { wallTimeToUtc } from "@/lib/zoned";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Orders — DiveDay" };

const STATUS_KEYS: Record<string, StaffMessageKey> = {
  open: "orders.detail.status.open",
  paid: "orders.detail.status.paid",
  void: "orders.detail.status.void",
  uncollectible: "orders.detail.status.uncollectible",
  refunded: "orders.detail.status.refunded",
};

/**
 * Paid deliberately has no entry: on this index it is the expected state of
 * nearly every row, and a success pill repeated down the whole column is
 * noise pretending to be information (design principle 9). Paid renders as
 * an empty cell; a badge appears only on the statuses that need a
 * staffer's eye.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  open: "primary",
  refunded: "warning",
};

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

/**
 * Where `orders/new` lands a staffer it turned away — for having no connected
 * account and no diver in hand, or for not being an owner/manager (H-14) — this
 * index, the surface that door belongs to, rather than `/divers`, which has
 * nothing to say about payments. Reading orders stays open to every staff role;
 * only raising one is gated, so this is a page they can still use.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  payment_not_connected: { tone: "warning", key: "orders.index.notice.paymentNotConnected" },
  not_authorized: { tone: "danger", key: "orders.index.notice.notAuthorized" },
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
 * Every order the shop has ever sent, filterable by status, diver, and
 * date — the index Orders never had (task 158, UX persona lens 17): before
 * this, an order was reachable only through the diver it belonged to.
 * Reports' revenue rows, the roster's payment cells, the command palette, and
 * Settings' Money group all link in here.
 */
export default async function OrdersIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    status?: string;
    personId?: string;
    personQuery?: string;
    from?: string;
    to?: string;
    range?: string;
    page?: string;
    notice?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { status, personId, personQuery, from, to, range, page, notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
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
  const trimmedQuery = personQuery?.trim() || undefined;

  const fromBoundary = dayBoundary(from, shop.timezone, 0);
  const toBoundary = dayBoundary(to, shop.timezone, 1);
  // The index is windowed unless it is told otherwise: without one it loaded
  // every invoice a shop has ever raised. `?range=all` is the stated way out,
  // and an explicit `?from=`/`?to=` replaces the window rather than nesting
  // inside it — a staffer who asked for last March means last March.
  const showAll = range === "all";
  const explicitRange = Boolean(fromBoundary || toBoundary);
  const windowed = !showAll && !explicitRange;
  const defaultFrom = windowed
    ? new Date(nowDate().getTime() - ORDER_DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
    : undefined;

  const orderPage = await listShopOrders(
    db,
    shop.id,
    {
      status: statusFilter,
      personId: personId || undefined,
      // A `personId` link (roster, diver record) is exact and takes priority
      // over a typed name — the two never combine, so the filter box always
      // reflects what it can actually change.
      personQuery: personId ? undefined : trimmedQuery,
      from: fromBoundary ?? defaultFrom,
      to: toBoundary,
    },
    // A non-numeric or missing `?page=` reads as page 1 rather than NaN;
    // `listShopOrders` clamps it into range either way.
    { page: Number.parseInt(page ?? "", 10) },
  );
  const rows = orderPage.rows;

  /** This page's URL with the filters kept and only the given params swapped. */
  const hrefWith = (overrides: { page?: number; range?: string | null }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (personId) query.set("personId", personId);
    if (personQuery) query.set("personQuery", personQuery);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const nextRange = overrides.range === undefined ? (showAll ? "all" : null) : overrides.range;
    if (nextRange) query.set("range", nextRange);
    if (overrides.page !== undefined && overrides.page > 1) {
      query.set("page", String(overrides.page));
    }
    const search = query.toString();
    return search ? `/shop/${shopSlug}/orders?${search}` : `/shop/${shopSlug}/orders`;
  };

  // Looked up rather than read off `rows[0]` — a filter that matches nothing
  // still has to say whose orders it was looking for, and the row-derived name
  // vanished on exactly the empty screen that needed the explanation most.
  const filteredPersonName = personId ? await getShopPersonName(db, shop.id, personId) : null;
  const hasFilters = Boolean(statusFilter || personId || trimmedQuery || from || to || showAll);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("orders.index.eyebrow")}
        title={t("orders.index.title")}
        description={t("orders.index.description")}
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
            {rows.length === 0 && !hasFilters ? null : paymentsConnected ? (
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

      {/* Above the filters because it is not something you filter for, and
          danger-toned rather than folded away: unconfirmed money is a financial
          obligation, not a notification to dismiss. An empty queue renders
          nothing at all — the calm state of this page is no panel. `mb-6`, not
          `mt-6`: the header above already carries `mb-8`, and the filter grid
          below carries no top margin of its own. */}
      {stuckPaymentOperations.length > 0 ? (
        <section aria-label={t("orders.index.paymentOps.sectionLabel")} className="mb-6">
          <ShopNotice tone="danger" role="status">
            <p className="font-medium">
              {t("orders.index.paymentOps.heading", { count: stuckPaymentOperations.length })}
            </p>
            <p className="mt-1 text-sm">{t("orders.index.paymentOps.detail")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {stuckPaymentOperations.map(({ intent, tripId, tripTitle, personName }) => (
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
                  {tripId ? (
                    <Link
                      href={`/shop/${shopSlug}/trips/${tripId}/guests`}
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

      {/* `QueryForm`, not the native GET submit this used to be: applying a
          filter tore the document down and landed the staffer back at the top
          of the page, above the row they were reading. Same URL, same server
          render (see `src/components/ui/QueryForm.tsx`). */}
      <QueryForm className="rounded-lg border border-border bg-surface p-4">
        <FieldGrid columns={4}>
          <Field label={t("orders.index.filters.statusLabel")}>
            <select name="status" defaultValue={statusFilter ?? ""} className={controlClass}>
              <option value="">{t("orders.index.filters.statusAll")}</option>
              {orderStatus.enumValues.map((value) => (
                <option key={value} value={value}>
                  {STATUS_KEYS[value] ? t(STATUS_KEYS[value]) : value}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("orders.index.filters.diverLabel")}>
            {/* Pinned by a `?personId=` link (roster, diver record). The name is
              shown but not editable, because `personId` wins over a typed one
              — and the id rides along as a hidden field so applying a status or
              a date does not silently throw the staffer back to every diver,
              which is what this form's missing `personId` used to do. */}
            <input
              type="text"
              name={personId ? undefined : "personQuery"}
              defaultValue={personId ? (filteredPersonName ?? "") : (personQuery ?? "")}
              placeholder={t("orders.index.filters.diverPlaceholder")}
              maxLength={120}
              readOnly={Boolean(personId)}
              disabled={Boolean(personId)}
              className={controlClass}
            />
          </Field>
          {personId ? <input type="hidden" name="personId" value={personId} /> : null}
          {showAll ? <input type="hidden" name="range" value="all" /> : null}
          <Field label={t("orders.index.filters.fromLabel")}>
            <input type="date" name="from" defaultValue={from ?? ""} className={controlClass} />
          </Field>
          <Field label={t("orders.index.filters.toLabel")}>
            <input type="date" name="to" defaultValue={to ?? ""} className={controlClass} />
          </Field>
          <FieldActions>
            {/* Secondary weight: a filter form is never the page's one obvious
              action — that stays with the header's New order (principle 8). */}
            <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
              {t("orders.index.filters.apply")}
            </button>
            {hasFilters ? (
              <Link
                href={`/shop/${shopSlug}/orders`}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "text-foreground",
                })}
              >
                {t("orders.index.filters.clear")}
              </Link>
            ) : null}
          </FieldActions>
        </FieldGrid>
      </QueryForm>

      {personId && filteredPersonName ? (
        <p className="mt-4 text-sm text-muted">
          {t("orders.index.filteredByDiver", { name: filteredPersonName })}
        </p>
      ) : null}

      {/* The window is stated, never silent, and the way out of it is right
          here. An explicit `?from=`/`?to=` says its own range in the fields
          above, so it gets no line of its own. */}
      {windowed || showAll ? (
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
          <span>
            {windowed
              ? t("orders.index.range.recentNote", { days: ORDER_DEFAULT_RANGE_DAYS })
              : t("orders.index.range.allNote")}
          </span>
          <Link
            href={hrefWith({ range: windowed ? "all" : null })}
            className="font-medium text-primary hover:underline"
          >
            {windowed
              ? t("orders.index.range.showAll")
              : t("orders.index.range.showRecent", { days: ORDER_DEFAULT_RANGE_DAYS })}
          </Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        // The same fork the header makes (Loop 3): with no orders on file the
        // one thing that moves a shop forward is either sending the first one
        // or connecting the account that can. Filtered-to-nothing is a
        // different problem and gets the way back out instead.
        <EmptyState className="mt-8">
          <p className="text-sm text-muted">
            {hasFilters
              ? t("orders.index.emptyFiltered")
              : paymentsConnected
                ? t("orders.index.emptyAll")
                : t("orders.index.emptyNoPayments")}
          </p>
          {hasFilters ? (
            <Link
              href={`/shop/${shopSlug}/orders`}
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
          )}
        </EmptyState>
      ) : (
        <Table shellClassName="mt-6">
          <THead>
            <Th>{t("orders.index.table.diver")}</Th>
            <Th hideBelow="sm">{t("orders.index.table.trip")}</Th>
            {/* Below sm the status folds under the diver's name (only when
                exceptional), so Date and Amount stay on screen at 390px. */}
            <Th hideBelow="sm">{t("orders.index.table.status")}</Th>
            <Th>{t("orders.index.table.date")}</Th>
            <Th numeric>{t("orders.index.table.amount")}</Th>
          </THead>
          <TBody>
            {rows.map((row) => {
              // Paid is the expected state and renders as quiet muted text;
              // only the exceptional statuses earn a badge (principle 9).
              const statusBadge =
                row.order.status === "paid" ? null : (
                  <Badge tone={STATUS_TONES[row.order.status] ?? "neutral"}>
                    {STATUS_KEYS[row.order.status]
                      ? t(STATUS_KEYS[row.order.status])
                      : row.order.status}
                  </Badge>
                );
              return (
                <tr key={row.order.id}>
                  <Td>
                    <Link
                      href={`/shop/${shopSlug}/orders/${row.order.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {row.person.fullName}
                    </Link>
                    <div className="text-xs text-muted sm:hidden">
                      {row.trip?.title ?? row.order.description ?? ""}
                    </div>
                    {statusBadge ? <div className="mt-1 sm:hidden">{statusBadge}</div> : null}
                  </Td>
                  <Td muted hideBelow="sm">
                    {row.trip?.title ?? row.order.description ?? "—"}
                  </Td>
                  {/* Settled rows leave the cell empty — "Paid" on 45 of 50
                      rows is the expected state formatted as information, so
                      a marker appears only where a staffer is needed. */}
                  <Td hideBelow="sm">{statusBadge}</Td>
                  <Td muted className="whitespace-nowrap tabular-nums">
                    {formatShortDate(row.order.createdAt, locale, shop.timezone)}
                  </Td>
                  <Td numeric>
                    {formatMoneyCents(row.order.totalCents, row.order.currency, locale)}
                  </Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <Pager
        page={orderPage.page}
        pageCount={orderPage.pageCount}
        href={(target) => hrefWith({ page: target })}
        total={t("orders.index.pagination.total", { count: orderPage.total })}
        t={t}
        className="mt-4"
      />
    </main>
  );
}
