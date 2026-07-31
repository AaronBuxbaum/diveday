import type { Metadata } from "next";
import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { listShopOrders } from "@/db/orders";
import { orderStatus } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { wallTimeToUtc } from "@/lib/zoned";

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
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { status, personId, personQuery, from, to } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const statusFilter = orderStatus.enumValues.includes(
    status as (typeof orderStatus.enumValues)[number],
  )
    ? (status as (typeof orderStatus.enumValues)[number])
    : undefined;
  const trimmedQuery = personQuery?.trim() || undefined;

  const rows = await listShopOrders(db, shop.id, {
    status: statusFilter,
    personId: personId || undefined,
    // A `personId` link (roster, diver record) is exact and takes priority
    // over a typed name — the two never combine, so the filter box always
    // reflects what it can actually change.
    personQuery: personId ? undefined : trimmedQuery,
    from: dayBoundary(from, shop.timezone, 0),
    to: dayBoundary(to, shop.timezone, 1),
  });

  const filteredPersonName = personId ? rows[0]?.person.fullName : null;
  const hasFilters = Boolean(statusFilter || personId || trimmedQuery || from || to);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("orders.index.eyebrow")}
        title={t("orders.index.title")}
        description={t("orders.index.description")}
        actions={
          <Link href={`/shop/${shopSlug}/orders/new`} className={buttonClass()}>
            {t("orders.index.newOrder")}
          </Link>
        }
      />

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
          <input
            type="text"
            name="personQuery"
            defaultValue={personId ? "" : (personQuery ?? "")}
            placeholder={t("orders.index.filters.diverPlaceholder")}
            maxLength={120}
            className={controlClass}
          />
        </Field>
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

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
          {hasFilters ? t("orders.index.emptyFiltered") : t("orders.index.emptyAll")}
        </p>
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
    </main>
  );
}
