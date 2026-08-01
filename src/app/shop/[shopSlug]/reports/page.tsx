import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listPendingMediaDeletions } from "@/db/media-deletions";
import { listStuckPaymentOperations } from "@/db/payment-operations";
import {
  canPersonViewShopReports,
  getMonthlyReport,
  pagedMonthlyReportTrips,
} from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import {
  addMonths,
  isoDate,
  type MonthRef,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { formatPercent, formatReportMoney, summarizeMonth, tripFillRate } from "@/lib/reporting";
import { requireStaffSession } from "@/lib/session";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { retryMediaDeletionAction } from "./actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const OPERATION_KIND_KEYS: Record<string, StaffMessageKey> = {
  checkout_session: "reports.operationKind.checkout_session",
  invoice: "reports.operationKind.invoice",
  refund: "reports.operationKind.refund",
};

const MEDIA_KIND_KEYS: Record<string, StaffMessageKey> = {
  course_photo: "reports.mediaKind.course_photo",
  recap_photo: "reports.mediaKind.recap_photo",
};

export const metadata: Metadata = {
  title: "Reports — DiveDay",
};

/** A headline number with a plain-language line under it. Semantic tokens only. */
function Metric({
  label,
  value,
  detail,
  celebrate = false,
  linkHref,
  linkLabel,
}: {
  label: string;
  value: string;
  detail: string;
  /** Mark a finished state (e.g. every waiver in) with a success check + words. */
  celebrate?: boolean;
  /** The revenue card's "View orders" jump (task 158) — omitted on every other metric. */
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{value}</p>
      <p
        className={`mt-2 flex items-center gap-1.5 text-sm ${celebrate ? "text-success" : "text-muted"}`}
      >
        {celebrate ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-4 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
        ) : null}
        {detail}
      </p>
      {linkHref && linkLabel ? (
        <Link
          href={linkHref}
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A slim, labelled share bar — fill or waiver completion as a portion of a
 * whole. A null ratio ("no bookings to measure") renders as a bare em dash, not
 * an empty bar, so "nothing to measure" never reads as a measured zero.
 */
function ShareBar({ ratio, label }: { ratio: number | null; label: string }) {
  if (ratio === null) {
    return (
      <span className="text-muted" role="img" aria-label={label}>
        —
      </span>
    );
  }
  const pct = Math.round(ratio * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 w-20 overflow-hidden rounded-full border border-border bg-surface-sunken"
        role="img"
        aria-label={label}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums font-medium text-foreground">{formatPercent(ratio)}</span>
    </div>
  );
}

/**
 * Owner reporting — the buyer's "how's my month" over data DiveDay already
 * holds: bookings, revenue collected, seat fill, and waiver completion, anchored
 * to the trips that departed in the chosen month (ADR 20260723-owner-reporting).
 * Owner/manager only: revenue is not for the daily crew.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; after?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { month, after } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  if (!shop) return null;
  const t = staffTranslator(locale);
  // Revenue is this shop's own money — a Bali shop's month reads in rupiah
  // (docs ADR 20260731-shop-currency). Note the fill/waiver percentages below
  // are ratios, not money, and stay currency-free.
  const currency = toShopCurrency(shop.currency);

  // Checked against the database, not the JWT, so a revoked manager loses
  // revenue access immediately (see canPersonViewShopReports).
  if (!(await canPersonViewShopReports(db, session.user.shopId, session.user.personId))) {
    redirect(`/shop/${shopSlug}`);
  }

  const tz = shop.timezone;
  const now = nowDate();
  const todayWall = utcToWallTime(now, tz);
  const thisMonth: MonthRef = { year: todayWall.year, month: todayWall.month };
  const current = parseMonthKey(month) ?? thisMonth;
  const next = addMonths(current, 1);

  const monthStart = wallTimeToUtc(
    { year: current.year, month: current.month, day: 1, hour: 0, minute: 0 },
    tz,
  );
  const monthEnd = wallTimeToUtc(
    { year: next.year, month: next.month, day: 1, hour: 0, minute: 0 },
    tz,
  );
  // The revenue card's "View orders" link (task 158) — the same month range as
  // the report itself, expressed as the `<input type="date">` values the
  // Orders index's own filter form reads.
  const lastDayOfMonth = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
  const revenueOrdersHref = `/shop/${shopSlug}/orders?from=${isoDate(current.year, current.month, 1)}&to=${isoDate(current.year, current.month, lastDayOfMonth)}`;

  const stuckPaymentOperations = await listStuckPaymentOperations(db, shop.id);
  const pendingMediaDeletions = await listPendingMediaDeletions(db, shop.id);
  const retryMediaDeletion = retryMediaDeletionAction.bind(null, shopSlug);
  // Totals see every trip in the month (summarizeMonth's fill rate and waiver
  // completion would quietly go wrong if this were page-limited); the table
  // below gets its own bounded, cursor-paginated slice.
  const [input, tripPage] = await Promise.all([
    getMonthlyReport(db, shop.id, monthStart, monthEnd),
    pagedMonthlyReportTrips(db, shop.id, monthStart, monthEnd, { cursor: after }),
  ]);
  const report = summarizeMonth(input);
  const { trips, nextCursor } = tripPage;

  const isThisMonth = current.year === thisMonth.year && current.month === thisMonth.month;
  const isFuture =
    current.year > thisMonth.year ||
    (current.year === thisMonth.year && current.month > thisMonth.month);
  // Paging forward past the current month is allowed but rarely useful — cap the
  // "next" arrow at the current month so the default view is the far edge.
  const prevMonthKey = monthKey(addMonths(current, -1));
  const nextMonthKey = isThisMonth ? null : monthKey(next);

  const bookingsDetail = isThisMonth
    ? t("reports.metrics.bookingsThisMonth", { count: report.tripCount })
    : t("reports.metrics.bookingsOther", { count: report.tripCount });

  // Honest framing: a past month has fully sailed; the current one is still
  // filling, so it never claims trips have "sailed" when some are still upcoming.
  const description = isThisMonth
    ? t("reports.description.thisMonth")
    : isFuture
      ? t("reports.description.future")
      : t("reports.description.past");

  const navClass =
    "inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition-colors duration-200 hover:bg-surface-sunken";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("reports.eyebrow")}
        title={t("reports.title")}
        description={description}
      />

      {stuckPaymentOperations.length > 0 ? (
        <section aria-label={t("reports.paymentOps.sectionLabel")} className="mb-8">
          <ShopNotice tone="warning" role="status">
            <p className="font-medium">
              {t("reports.paymentOps.heading", { count: stuckPaymentOperations.length })}
            </p>
            <p className="mt-1 text-sm">{t("reports.paymentOps.detail")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {stuckPaymentOperations.map(({ intent, tripId, tripTitle, personName }) => (
                <li key={intent.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{t(OPERATION_KIND_KEYS[intent.kind])}</span>
                  {tripTitle ? <span>· {tripTitle}</span> : null}
                  {personName ? <span>· {personName}</span> : null}
                  <span className="text-muted">
                    ·{" "}
                    {t("reports.paymentOps.started", {
                      date: formatShortDate(intent.startedAt, locale, tz),
                    })}
                    {intent.stripeObjectId
                      ? ` · ${t("reports.paymentOps.stripeId", { id: intent.stripeObjectId })}`
                      : ""}
                  </span>
                  {tripId ? (
                    <Link
                      href={`/shop/${shopSlug}/trips/${tripId}/guests`}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      {t("reports.paymentOps.openTrip")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

      {pendingMediaDeletions.length > 0 ? (
        <section aria-label={t("reports.mediaDeletions.sectionLabel")} className="mb-8">
          <ShopNotice tone="warning" role="status">
            <p className="font-medium">
              {t("reports.mediaDeletions.heading", { count: pendingMediaDeletions.length })}
            </p>
            <p className="mt-1 text-sm">{t("reports.mediaDeletions.detail")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {pendingMediaDeletions.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{t(MEDIA_KIND_KEYS[attempt.kind])}</span>
                  <span className="text-muted">
                    ·{" "}
                    {t("reports.mediaDeletions.queued", {
                      date: formatShortDate(attempt.createdAt, locale, tz),
                    })}
                    {attempt.lastError ? ` · ${attempt.lastError}` : ""}
                  </span>
                  <form action={retryMediaDeletion}>
                    <input type="hidden" name="attemptId" value={attempt.id} />
                    <SubmitButton
                      pendingLabel={t("reports.mediaDeletions.retrying")}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("reports.mediaDeletions.retry")}
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

      {/* Month navigator — plain server-rendered links, no client JS. */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {monthLabel(current)}
          {isThisMonth ? (
            <span className="ml-2 text-sm font-normal text-muted">{t("reports.soFar")}</span>
          ) : null}
        </h2>
        <nav aria-label={t("reports.chooseMonth")} className="flex items-center gap-2">
          <Link
            href={`/shop/${shopSlug}/reports?month=${prevMonthKey}`}
            aria-label={t("reports.previousMonth")}
            className={navClass}
          >
            <span aria-hidden="true">←</span>
          </Link>
          {nextMonthKey ? (
            <Link
              href={`/shop/${shopSlug}/reports?month=${nextMonthKey}`}
              aria-label={t("reports.nextMonth")}
              className={navClass}
            >
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t("reports.currentMonthTitle")}
              className={`${navClass} cursor-default text-muted opacity-40`}
            >
              →
            </span>
          )}
        </nav>
      </div>

      {report.tripCount === 0 ? (
        <ShopNotice tone="neutral" role="status">
          {isFuture ? t("reports.noTripsFuture") : t("reports.noTripsPast")}
        </ShopNotice>
      ) : (
        <>
          <section
            aria-label={t("reports.numbersLabel")}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Metric
              label={t("reports.metrics.revenueLabel")}
              value={formatReportMoney(report.revenueCents, currency, locale)}
              detail={t("reports.metrics.revenueDetail")}
              linkHref={revenueOrdersHref}
              linkLabel={t("reports.metrics.revenueViewOrders")}
            />
            <Metric
              label={t("reports.metrics.bookingsLabel")}
              value={String(report.seatsBooked)}
              detail={bookingsDetail}
            />
            <Metric
              label={t("reports.metrics.seatFillLabel")}
              value={formatPercent(report.fillRate)}
              detail={t("reports.metrics.seatFillDetail", {
                booked: report.seatsBooked,
                offered: report.seatsOffered,
                count: report.atCapacityTrips,
              })}
            />
            <Metric
              label={t("reports.metrics.waiversLabel")}
              value={formatPercent(report.waiverCompletion)}
              celebrate={report.waiverCompletion === 1}
              detail={
                report.waiverOutstanding > 0
                  ? t("reports.metrics.waiversOutstanding", { count: report.waiverOutstanding })
                  : t("reports.metrics.waiversAllIn")
              }
            />
          </section>

          <section aria-label={t("reports.tripsThisMonth")} className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">{t("reports.tripsThisMonth")}</h2>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t("reports.table.trip")}
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">
                      {t("reports.table.seats")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t("reports.table.fill")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t("reports.table.waivers")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {trips.map((trip) => {
                    const waiverRatio =
                      trip.activeBookings > 0 ? trip.waiverComplete / trip.activeBookings : null;
                    return (
                      <tr key={trip.tripId}>
                        <td className="px-4 py-3">
                          <Link
                            href={`/shop/${shopSlug}/trips/${trip.tripId}/guests`}
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {trip.title}
                          </Link>
                          <div className="text-xs text-muted">
                            {formatShortDate(trip.startsAt, locale, tz)}
                            {/* The raw ratio the Seats column carries on wider screens,
                                folded in here so a phone never loses "70% of what?". */}
                            <span className="tabular-nums sm:hidden">
                              {" · "}
                              {t("reports.seatsMobile", {
                                booked: trip.activeBookings,
                                capacity: trip.capacity,
                              })}
                            </span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 tabular-nums text-muted sm:table-cell">
                          {trip.activeBookings}/{trip.capacity}
                        </td>
                        <td className="px-4 py-3">
                          <ShareBar
                            ratio={tripFillRate(trip)}
                            label={t("reports.fillLabel", {
                              booked: trip.activeBookings,
                              capacity: trip.capacity,
                            })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <ShareBar
                            ratio={waiverRatio}
                            label={t("reports.waiversRowLabel", {
                              complete: trip.waiverComplete,
                              total: trip.activeBookings,
                            })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nextCursor || after ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {nextCursor ? (
                  <Link
                    href={`/shop/${shopSlug}/reports?month=${monthKey(current)}&after=${nextCursor}`}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("reports.showMoreTrips")}
                  </Link>
                ) : null}
                {after ? (
                  <Link
                    href={`/shop/${shopSlug}/reports?month=${monthKey(current)}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {t("reports.backToTop")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
