import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { listShopOrders, ORDER_DEFAULT_RANGE_DAYS } from "@/db/orders";
import { getShopPersonName } from "@/db/people";
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

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Orders — DiveDay" };

const STATUS_KEYS: Record<string, StaffMessageKey> = {
  open: "orders.detail.status.open",
  paid: "orders.detail.status.paid",
  void: "orders.detail.status.void",
  uncollectible: "orders.detail.status.uncollectible",
  refunded: "orders.detail.status.refunded",
};

const STATUS_TONES: Record<string, BadgeTone> = {
  paid: "success",
  open: "primary",
};

/**
 * Where `orders/new` lands a staffer it turned away for having no connected
 * account and no diver in hand — this index, the surface that door belongs
 * to, rather than `/divers`, which has nothing to say about payments.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  payment_not_connected: { tone: "warning", key: "orders.index.notice.paymentNotConnected" },
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
 * Every invoice the shop has ever sent, filterable by status, diver, and
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
          paymentsConnected ? (
            <Link href={`/shop/${shopSlug}/orders/new`} className={buttonClass()}>
              {t("orders.index.newOrder")}
            </Link>
          ) : (
            <Link href={`/shop/${shopSlug}/settings#money`} className={buttonClass()}>
              {t("shared.payments.connect")}
            </Link>
          )
        }
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      <FieldGrid as="form" columns={4} className="rounded-lg border border-border bg-surface p-4">
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
          <button type="submit" className={buttonClass({ size: "sm" })}>
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
            <Link
              href={`/shop/${shopSlug}/settings#money`}
              className={buttonClass({ className: "mt-4" })}
            >
              {t("shared.payments.connect")}
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("orders.index.table.diver")}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">
                  {t("orders.index.table.trip")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("orders.index.table.status")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("orders.index.table.date")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("orders.index.table.amount")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.order.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/shop/${shopSlug}/orders/${row.order.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {row.person.fullName}
                    </Link>
                    <div className="text-xs text-muted sm:hidden">
                      {row.trip?.title ?? row.order.description ?? ""}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">
                    {row.trip?.title ?? row.order.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[row.order.status] ?? "neutral"}>
                      {STATUS_KEYS[row.order.status]
                        ? t(STATUS_KEYS[row.order.status])
                        : row.order.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted tabular-nums">
                    {formatShortDate(row.order.createdAt, locale, shop.timezone)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoneyCents(row.order.totalCents, row.order.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
