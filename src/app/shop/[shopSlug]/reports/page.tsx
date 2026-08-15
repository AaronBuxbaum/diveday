import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import {
  canPersonViewShopReports,
  earliestReportedTripStart,
  getMonthlyReport,
  pagedMonthlyReportTrips,
} from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  addMonths,
  clampMonth,
  compareMonths,
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

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Reports — DiveDay",
};

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
 *
 * A report and nothing else. Three back-office queues used to hang off the
 * bottom of this page — unconfirmed Stripe operations, stored files a delete
 * never finished, erasures still owed at the processor — which made a third of
 * "how did the month go" into a to-do list about something else entirely. Each
 * moved to the surface that owns its object: payments to the Orders index,
 * both deletion queues to Settings' "Data & integrations" group. Nothing on
 * this page is actionable now except the month you are looking at and the
 * revenue card's jump into Orders.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { month, page } = await searchParams;
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
    // The nearest parent surface *with a notice code it handles* — a refusal
    // that teleports you to Today saying nothing is indistinguishable from a
    // dead link (task 82). The nav already hides this destination from
    // non-owners/managers (ADR 20260724-role-gated-surfaces-hide-not-explain);
    // this landing is for everyone who arrived by bookmark, deep link, or a
    // role that changed under them.
    redirect(`/shop/${shopSlug}?notice=reports_not_authorized`);
  }

  const tz = shop.timezone;
  const now = nowDate();
  const todayWall = utcToWallTime(now, tz);
  const thisMonth: MonthRef = { year: todayWall.year, month: todayWall.month };
  // The oldest month this shop could have anything to report on. It is the
  // floor of both the picker and the back arrow: walking further back only ever
  // renders identical empty months, and `?month=0001-01` should land somewhere
  // real rather than querying the year 1. A shop with no trips at all floors at
  // the current month; a shop whose only trips are still ahead floors there too
  // (`clampMonth` needs min <= max, and "earliest" can be in the future).
  //
  // #411 batched this into a `Promise.all` alongside the ops-panel lists and
  // the erase gate. Those four reads left with the panels they fed, so the one
  // read that remains is a plain await again — a `Promise.all` of one is a
  // parallelization of nothing.
  const earliestTripStart = await earliestReportedTripStart(db, shop.id);
  const earliestWall = earliestTripStart ? utcToWallTime(earliestTripStart, tz) : null;
  const earliestTripMonth: MonthRef = earliestWall
    ? { year: earliestWall.year, month: earliestWall.month }
    : thisMonth;
  const floorMonth =
    compareMonths(earliestTripMonth, thisMonth) < 0 ? earliestTripMonth : thisMonth;
  // No ceiling: a shop that schedules ahead can still ask for a month that has
  // not happened yet, and the page frames it honestly as one that hasn't sailed.
  const current = clampMonth(parseMonthKey(month) ?? thisMonth, floorMonth);
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

  // Totals see every trip in the month (summarizeMonth's fill rate and waiver
  // completion would quietly go wrong if this were page-limited); the table
  // below gets its own bounded, cursor-paginated slice.
  const [input, tripPage] = await Promise.all([
    getMonthlyReport(db, shop.id, monthStart, monthEnd),
    // A non-numeric or missing `?page=` reads as page 1; the query clamps it
    // into range, so switching to a shorter month never strands the reader on
    // a page that month does not have.
    pagedMonthlyReportTrips(db, shop.id, monthStart, monthEnd, {
      page: Number.parseInt(page ?? "", 10),
    }),
  ]);
  const report = summarizeMonth(input);
  const { trips } = tripPage;

  const isThisMonth = current.year === thisMonth.year && current.month === thisMonth.month;
  const isFuture =
    current.year > thisMonth.year ||
    (current.year === thisMonth.year && current.month > thisMonth.month);
  // Paging forward past the current month is allowed but rarely useful — cap the
  // "next" arrow at the current month so the default view is the far edge. The
  // back arrow stops at the shop's first month for the mirror-image reason:
  // beyond it there is nothing but identical empty months.
  const prevMonthKey =
    compareMonths(current, floorMonth) > 0 ? monthKey(addMonths(current, -1)) : null;
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

  // A square 44px target holding one glyph, through the shared `size: "icon"`
  // rather than a hand-spelled `size-11` — this pair was one of the four
  // spellings that size exists to end (see components/ui/button.ts). Plain
  // `secondary`, with no `text-foreground` override: two `text-<color>`
  // utilities resolve by stylesheet order rather than by the order they are
  // written, and `globals.css` declares `--color-primary` after
  // `--color-foreground`, so an override there is inert. That makes these the
  // same construction as the "Go" button between them, which is what the
  // navigator wanted all along.
  const navClass = buttonClass({ variant: "secondary", size: "icon" });
  // The far edge of the range: decorative and `aria-hidden`, so it wears the
  // same box and is made inert rather than merely restyled. `pointer-events-none`
  // and not `cursor-default` — the shared base carries `cursor-pointer`, which
  // wins by the same ordering rule, and this also stops the hover background
  // lighting up an arrow that goes nowhere.
  const navDisabledClass = `${navClass} pointer-events-none opacity-40`;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("reports.eyebrow")}
        title={t("reports.title")}
        description={description}
      />

      {/*
        Month navigator — plain server-rendered links plus one GET form, no
        client JS. The arrows walk neighbouring months; the picker exists
        because they are useless for a far one (last July used to be thirteen
        clicks). `<input type="month">` submits exactly the `YYYY-MM` shape
        `parseMonthKey` already reads, and its `min` matches the floor the page
        clamps to server-side, so the control cannot offer a month the page
        would silently rewrite.
      */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {monthLabel(current, locale)}
          {isThisMonth ? (
            <span className="ml-2 text-sm font-normal text-muted">{t("reports.soFar")}</span>
          ) : null}
        </h2>
        <nav aria-label={t("reports.chooseMonth")} className="flex flex-wrap items-center gap-2">
          {prevMonthKey ? (
            <Link
              href={`/shop/${shopSlug}/reports?month=${prevMonthKey}`}
              aria-label={t("reports.previousMonth")}
              className={navClass}
            >
              <span aria-hidden="true">←</span>
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t("reports.earliestMonthTitle")}
              className={navDisabledClass}
            >
              ←
            </span>
          )}
          <form className="flex items-center gap-2">
            <label htmlFor="report-month" className="sr-only">
              {t("reports.monthPicker.label")}
            </label>
            <input
              id="report-month"
              type="month"
              name="month"
              defaultValue={monthKey(current)}
              min={monthKey(floorMonth)}
              className={`${controlClass} w-40`}
            />
            <button
              type="submit"
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "text-foreground",
              })}
            >
              {t("reports.monthPicker.go")}
            </button>
          </form>
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
              className={navDisabledClass}
            >
              →
            </span>
          )}
        </nav>
      </div>

      {report.tripCount === 0 ? (
        // A month with no departures is this page's rest state, not news about
        // it: `ShopNotice` is the vocabulary for something that *happened*
        // (a save, a refusal, a permission bounce), and wearing it here made an
        // ordinary quiet January read as a warning.
        <EmptyState>
          <p className="mx-auto max-w-md text-sm text-muted">
            {isFuture ? t("reports.noTripsFuture") : t("reports.noTripsPast")}
          </p>
        </EmptyState>
      ) : (
        <>
          <section
            aria-label={t("reports.numbersLabel")}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <ShopStat
              label={t("reports.metrics.revenueLabel")}
              value={formatReportMoney(report.revenueCents, currency, locale)}
              detail={t("reports.metrics.revenueDetail")}
              linkHref={revenueOrdersHref}
              linkLabel={t("reports.metrics.revenueViewOrders")}
            />
            {/*
              Tips sit beside revenue rather than inside it (PAY-M2): they are
              their own Stripe charge, 100% to the shop, and never part of the
              booking payment gate — so the two numbers together are what makes
              the month reconcile against the shop's Stripe dashboard, while
              "Revenue collected" keeps meaning what its detail line says.
            */}
            <ShopStat
              label={t("reports.metrics.tipsLabel")}
              value={formatReportMoney(report.tipsCents, currency, locale)}
              detail={t("reports.metrics.tipsDetail", { count: report.tipCount })}
            />
            <ShopStat
              label={t("reports.metrics.bookingsLabel")}
              value={String(report.seatsBooked)}
              detail={bookingsDetail}
            />
            <ShopStat
              label={t("reports.metrics.seatFillLabel")}
              value={formatPercent(report.fillRate)}
              detail={t("reports.metrics.seatFillDetail", {
                booked: report.seatsBooked,
                offered: report.seatsOffered,
                count: report.atCapacityTrips,
              })}
            />
            <ShopStat
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
            <Table>
              <THead>
                <Th>{t("reports.table.trip")}</Th>
                <Th numeric hideBelow="sm">
                  {t("reports.table.seats")}
                </Th>
                <Th>{t("reports.table.fill")}</Th>
                <Th>{t("reports.table.waivers")}</Th>
              </THead>
              <TBody>
                {trips.map((trip) => {
                  const waiverRatio =
                    trip.activeBookings > 0 ? trip.waiverComplete / trip.activeBookings : null;
                  return (
                    <tr key={trip.tripId}>
                      <Td>
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
                      </Td>
                      <Td numeric muted hideBelow="sm">
                        {trip.activeBookings}/{trip.capacity}
                      </Td>
                      <Td>
                        <ShareBar
                          ratio={tripFillRate(trip)}
                          label={t("reports.fillLabel", {
                            booked: trip.activeBookings,
                            capacity: trip.capacity,
                          })}
                        />
                      </Td>
                      <Td>
                        <ShareBar
                          ratio={waiverRatio}
                          label={t("reports.waiversRowLabel", {
                            complete: trip.waiverComplete,
                            total: trip.activeBookings,
                          })}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
            <Pager
              page={tripPage.page}
              pageCount={tripPage.pageCount}
              href={(target) =>
                `/shop/${shopSlug}/reports?month=${monthKey(current)}${
                  target > 1 ? `&page=${target}` : ""
                }`
              }
              total={t("reports.pagination.total", { count: tripPage.total })}
              t={t}
              className="mt-4"
            />
          </section>
        </>
      )}
    </main>
  );
}
