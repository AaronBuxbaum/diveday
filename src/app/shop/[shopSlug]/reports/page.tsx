import type { Metadata } from "next";
import Link from "next/link";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listStuckPaymentOperations } from "@/db/payment-operations";
import { canPersonViewShopReports, getMonthlyReport } from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { addMonths, type MonthRef, monthKey, monthLabel, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { formatPercent, formatReportMoney, summarizeMonth, tripFillRate } from "@/lib/reporting";
import { requireStaffSession } from "@/lib/session";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

const OPERATION_KIND_LABELS = {
  checkout_session: "Checkout",
  invoice: "Invoice",
  refund: "Refund",
} as const;

export const metadata: Metadata = {
  title: "Reports — DiveDay",
};

/** A headline number with a plain-language line under it. Semantic tokens only. */
function Metric({
  label,
  value,
  detail,
  celebrate = false,
}: {
  label: string;
  value: string;
  detail: string;
  /** Mark a finished state (e.g. every waiver in) with a success check + words. */
  celebrate?: boolean;
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
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { month } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;

  // Checked against the database, not the JWT, so a revoked manager loses
  // revenue access immediately (see canPersonViewShopReports).
  if (!(await canPersonViewShopReports(db, session.user.shopId, session.user.personId))) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow="Owner"
          title="Reports"
          description="How the shop is doing — bookings, revenue, fill rate, and waivers."
        />
        <ShopNotice tone="warning" role="status">
          Reports include the shop's revenue, so they're limited to the owner or manager. Ask them
          if you need this month's numbers.
        </ShopNotice>
      </main>
    );
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

  const stuckPaymentOperations = await listStuckPaymentOperations(db, shop.id);
  const input = await getMonthlyReport(db, shop.id, monthStart, monthEnd);
  const report = summarizeMonth(input);
  const trips = [...input.trips].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const isThisMonth = current.year === thisMonth.year && current.month === thisMonth.month;
  const isFuture =
    current.year > thisMonth.year ||
    (current.year === thisMonth.year && current.month > thisMonth.month);
  // Paging forward past the current month is allowed but rarely useful — cap the
  // "next" arrow at the current month so the default view is the far edge.
  const prevMonthKey = monthKey(addMonths(current, -1));
  const nextMonthKey = isThisMonth ? null : monthKey(next);

  const bookingsDetail = isThisMonth
    ? `${report.tripCount} ${report.tripCount === 1 ? "trip" : "trips"} on the books so far`
    : `across ${report.tripCount} ${report.tripCount === 1 ? "trip" : "trips"}`;

  // Honest framing: a past month has fully sailed; the current one is still
  // filling, so it never claims trips have "sailed" when some are still upcoming.
  const description = isThisMonth
    ? "Bookings, revenue, seat fill, and waivers for this month's trips — so far."
    : isFuture
      ? "Bookings, revenue, seat fill, and waivers for this month's trips."
      : "Bookings, revenue, seat fill, and waivers for the trips that sailed.";

  const navClass =
    "inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition-colors duration-200 hover:bg-surface-sunken";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader eyebrow="Owner" title="How's your month" description={description} />

      {stuckPaymentOperations.length > 0 ? (
        <section aria-label="Payment operations needing reconciliation" className="mb-8">
          <ShopNotice tone="warning" role="status">
            <p className="font-medium">
              {stuckPaymentOperations.length}{" "}
              {stuckPaymentOperations.length === 1 ? "payment attempt" : "payment attempts"} need
              reconciliation
            </p>
            <p className="mt-1 text-sm">
              Stripe was asked to do something and the app never confirmed how it went — check each
              against the Stripe dashboard and finish it by hand.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {stuckPaymentOperations.map(({ intent, tripId, tripTitle, personName }) => (
                <li key={intent.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{OPERATION_KIND_LABELS[intent.kind]}</span>
                  {tripTitle ? <span>· {tripTitle}</span> : null}
                  {personName ? <span>· {personName}</span> : null}
                  <span className="text-muted">
                    · started {formatShortDate(intent.startedAt, "en-US", tz)}
                    {intent.stripeObjectId ? ` · Stripe: ${intent.stripeObjectId}` : ""}
                  </span>
                  {tripId ? (
                    <Link
                      href={`/shop/${shopSlug}/trips/${tripId}/guests`}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      Open trip
                    </Link>
                  ) : null}
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
          {isThisMonth ? <span className="ml-2 text-sm font-normal text-muted">so far</span> : null}
        </h2>
        <nav aria-label="Choose month" className="flex items-center gap-2">
          <Link
            href={`/shop/${shopSlug}/reports?month=${prevMonthKey}`}
            aria-label="Previous month"
            className={navClass}
          >
            <span aria-hidden="true">←</span>
          </Link>
          {nextMonthKey ? (
            <Link
              href={`/shop/${shopSlug}/reports?month=${nextMonthKey}`}
              aria-label="Next month"
              className={navClass}
            >
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title="You're viewing the current month"
              className={`${navClass} cursor-default text-muted opacity-40`}
            >
              →
            </span>
          )}
        </nav>
      </div>

      {report.tripCount === 0 ? (
        <ShopNotice tone="neutral" role="status">
          {isFuture
            ? "Nothing on the books for this month yet — bookings will show up here as they come in."
            : "No trips sailed this month. Pick another month to see how it went."}
        </ShopNotice>
      ) : (
        <>
          <section
            aria-label="This month's numbers"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Metric
              label="Revenue collected"
              value={formatReportMoney(report.revenueCents)}
              detail="Payments and deposits taken on this month's trips"
            />
            <Metric label="Bookings" value={String(report.seatsBooked)} detail={bookingsDetail} />
            <Metric
              label="Seat fill"
              value={formatPercent(report.fillRate)}
              detail={`${report.seatsBooked} of ${report.seatsOffered} seats · ${report.atCapacityTrips} ${
                report.atCapacityTrips === 1 ? "boat" : "boats"
              } full`}
            />
            <Metric
              label="Waivers signed"
              value={formatPercent(report.waiverCompletion)}
              celebrate={report.waiverCompletion === 1}
              detail={
                report.waiverOutstanding > 0
                  ? `${report.waiverOutstanding} still to collect`
                  : "Everyone's paperwork is in"
              }
            />
          </section>

          <section aria-label="Trips this month" className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">Trips this month</h2>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Trip
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">
                      Seats
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Fill
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Waivers
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
                          <div className="font-medium text-foreground">{trip.title}</div>
                          <div className="text-xs text-muted">
                            {formatShortDate(trip.startsAt, "en-US", tz)}
                            {/* The raw ratio the Seats column carries on wider screens,
                                folded in here so a phone never loses "70% of what?". */}
                            <span className="tabular-nums sm:hidden">
                              {" · "}
                              {trip.activeBookings}/{trip.capacity} seats
                            </span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 tabular-nums text-muted sm:table-cell">
                          {trip.activeBookings}/{trip.capacity}
                        </td>
                        <td className="px-4 py-3">
                          <ShareBar
                            ratio={tripFillRate(trip)}
                            label={`${trip.activeBookings} of ${trip.capacity} seats booked`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <ShareBar
                            ratio={waiverRatio}
                            label={`${trip.waiverComplete} of ${trip.activeBookings} waivers signed`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
