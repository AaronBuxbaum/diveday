import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import {
  canPersonViewShopReports,
  crewCountsByTrip,
  earliestImportedFinancialHistoryDate,
  earliestReportedTripStart,
  getMonthlyReport,
  pagedMonthlyReportTrips,
} from "@/db/reporting";
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
import {
  compareMonthlyReports,
  formatPercent,
  formatPercentChange,
  formatPointsChange,
  formatReportMoney,
  type MonthComparison,
  summarizeMonth,
  tripFillRate,
} from "@/lib/reporting";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
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

function earlierMonth(left: MonthRef, right: MonthRef): MonthRef {
  return compareMonths(left, right) > 0 ? right : left;
}

/**
 * A slim, labelled share bar — fill or waiver completion as a portion of a
 * whole. A null ratio ("no bookings to measure") renders as a bare em dash, not
 * an empty bar, so "nothing to measure" never reads as a measured zero.
 *
 * **The ink is on the gap, not the achievement** (issue 775). This drew its
 * filled portion in `bg-primary`, which made a healthy row the loudest thing in
 * its column and left the rows needing an owner as the faintest: on the seeded
 * month, fifteen of twenty-one waiver rows read 100% in full teal while the two
 * at 0% — a booked charter with not one signature — drew an empty grey track
 * and slid past the eye. §9 spends ink on the rows that need a staffer, so the
 * fill is now quiet at every ratio and the *remainder* is what can carry a
 * tone. That needs no threshold to argue about: at 0% the whole bar is the
 * warning, at 100% there is nothing left to warn about, and every value between
 * shades itself.
 *
 * `remainder` is opt-in per column because the two gaps do not mean the same
 * thing. Unsigned waivers are work somebody has to chase. Empty seats on a
 * month being reviewed are a fact — a half-full boat is not a task, and toning
 * one would put amber on most rows of a working shop's report and spend exactly
 * the currency this change is trying to save.
 */
function ShareBar({
  ratio,
  label,
  value,
  remainder = "quiet",
}: {
  ratio: number | null;
  label: string;
  /** Shown beside the bar. Omit where a neighbouring cell already states it. */
  value?: string;
  remainder?: "quiet" | "attention";
}) {
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
        className={`h-2 w-20 overflow-hidden rounded-full border border-border ${
          remainder === "attention" && pct < 100 ? "bg-warning" : "bg-surface-sunken"
        }`}
        role="img"
        // Already the exact counts in words ("8 of 9 waivers signed"), which is
        // why dropping a numeral below costs a screen reader nothing.
        aria-label={label}
      >
        <div className="h-full rounded-full bg-muted" style={{ width: `${pct}%` }} />
      </div>
      {value ? <span className="tabular-nums font-medium text-foreground">{value}</span> : null}
    </div>
  );
}

/**
 * Owner reporting — the buyer's "how's my month" over data DiveDay already
 * holds: bookings, net revenue, seat fill, and waiver completion. Trip metrics
 * stay anchored to departures; clearly-labelled source payments/refunds add a
 * separate unverified financial slice by their source calendar date (ADR
 * 20260723-owner-reporting and 20260816-imported-payment-history-is-evidence).
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
  const { shopSlug } = await params;
  const { month, page } = await searchParams;
  // Checked against the database, not the JWT, so a revoked manager loses
  // revenue access immediately (see canPersonViewShopReports).
  //
  // A refusal lands on Today — the nearest parent surface *with a notice code
  // it handles*, because a refusal that teleports you saying nothing is
  // indistinguishable from a dead link (task 82). The nav already hides this
  // destination from non-owners/managers (ADR
  // 20260724-role-gated-surfaces-hide-not-explain); this landing is for
  // everyone who arrived by bookmark, deep link, or a role that changed under
  // them.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Revenue is this shop's own money — a Bali shop's month reads in rupiah
  // (docs ADR 20260731-shop-currency). Note the fill/waiver percentages below
  // are ratios, not money, and stay currency-free.
  const currency = toShopCurrency(shop.currency);

  const tz = shop.timezone;
  const now = nowDate();
  const todayWall = utcToWallTime(now, tz);
  const thisMonth: MonthRef = { year: todayWall.year, month: todayWall.month };
  // The oldest month this shop could have anything to report on. It is the
  // floor of both the picker and the back arrow: walking further back only ever
  // renders identical empty months, and `?month=0001-01` should land somewhere
  // real rather than querying the year 1. An imported payment/refund is a
  // genuine financial fact even without a DiveDay departure, so its earliest
  // eligible source day also moves this floor.
  //
  // #411 batched this into a `Promise.all` alongside the ops-panel lists and
  // the erase gate. Those four reads left with the panels they fed, so the one
  // read that remains is a plain await again — a `Promise.all` of one is a
  // parallelization of nothing.
  const earliestTripStart = await earliestReportedTripStart(db, shop.id);
  const earliestImportedFinancialDate = await earliestImportedFinancialHistoryDate(
    db,
    shop.id,
    currency,
  );
  const earliestWall = earliestTripStart ? utcToWallTime(earliestTripStart, tz) : null;
  const earliestTripMonth: MonthRef = earliestWall
    ? { year: earliestWall.year, month: earliestWall.month }
    : thisMonth;
  const earliestImportedMonth = earliestImportedFinancialDate
    ? {
        year: Number(earliestImportedFinancialDate.slice(0, 4)),
        month: Number(earliestImportedFinancialDate.slice(5, 7)),
      }
    : thisMonth;
  const floorMonth = [earliestTripMonth, earliestImportedMonth, thisMonth].reduce(
    earlierMonth,
    thisMonth,
  );
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
  const revenueOrdersHref = `/shop/${shopSlug}/orders?from=${isoDate(current.year, current.month, 1)}&to=${isoDate(current.year, current.month, lastDayOfMonth)}&range=custom`;

  // Which prior month, if any, backs each headline card's comparison (issue
  // #700). Same month last year first — the only comparison that carries
  // information for a business this seasonal — falling back to the previous
  // month only when the shop could not possibly have data that far back, and
  // never silently: `floorMonth` (computed above) is the same earliest-month
  // floor the picker itself is clamped to, so this asks the identical
  // question the page already answers for a different reason, rather than
  // inferring "no data" from a fetched month that turns out all zeroes — a
  // month a shop genuinely sat out is a real baseline, not a missing one.
  const yearAgoMonth = addMonths(current, -12);
  const previousMonth = addMonths(current, -1);
  const baselineMonth: MonthRef | null =
    compareMonths(yearAgoMonth, floorMonth) >= 0
      ? yearAgoMonth
      : compareMonths(previousMonth, floorMonth) >= 0
        ? previousMonth
        : null;
  const baselineKind: "yearAgo" | "previousMonth" | null = baselineMonth
    ? compareMonths(baselineMonth, yearAgoMonth) === 0
      ? "yearAgo"
      : "previousMonth"
    : null;

  // Totals see every trip in the month (summarizeMonth's fill rate and waiver
  // completion would quietly go wrong if this were page-limited); the table
  // below gets its own bounded, cursor-paginated slice. The baseline month
  // (when one applies) rides the same Promise.all — its own report costs the
  // identical shape of query as the current month's, scoped to one more
  // month's trips, never to the shop's whole history.
  const baselineWindow = baselineMonth
    ? {
        start: wallTimeToUtc(
          { year: baselineMonth.year, month: baselineMonth.month, day: 1, hour: 0, minute: 0 },
          tz,
        ),
        end: wallTimeToUtc(
          {
            year: addMonths(baselineMonth, 1).year,
            month: addMonths(baselineMonth, 1).month,
            day: 1,
            hour: 0,
            minute: 0,
          },
          tz,
        ),
      }
    : null;
  // Both months ride the same Promise.all rather than running sequentially,
  // so the wall-clock cost is the slower of the two calls, not their sum —
  // one more month's worth of trips, bookings and payments, never a second
  // pass over the shop's whole history. See the PR description for the
  // measured cost.
  const [input, tripPage, baselineInput] = await Promise.all([
    getMonthlyReport(db, shop.id, monthStart, monthEnd, { currency, timeZone: tz }),
    // A non-numeric or missing `?page=` reads as page 1; the query clamps it
    // into range, so switching to a shorter month never strands the reader on
    // a page that month does not have.
    pagedMonthlyReportTrips(db, shop.id, monthStart, monthEnd, {
      page: Number.parseInt(page ?? "", 10),
    }),
    baselineWindow
      ? getMonthlyReport(db, shop.id, baselineWindow.start, baselineWindow.end, {
          currency,
          timeZone: tz,
        })
      : Promise.resolve(null),
  ]);
  const report = summarizeMonth(input);
  const baselineReport = baselineInput ? summarizeMonth(baselineInput) : null;
  const comparison: MonthComparison | null =
    baselineReport && baselineKind
      ? compareMonthlyReports(baselineKind, report, baselineReport, currency)
      : null;
  const { trips } = tripPage;
  const hasMonthlyActivity = report.tripCount > 0 || report.importedFinancialRecordCount > 0;
  // How many crew were assigned per departure on this page — the number
  // only, never a cost (issue #700). Scoped to the table's own page of
  // trips, the same bound every other per-trip figure on this page already
  // keeps to.
  const crewCounts = trips.length
    ? await crewCountsByTrip(
        db,
        shop.id,
        trips.map((trip) => trip.tripId),
      )
    : new Map<string, number>();

  // The comparison line under each headline card — "{trend}vs {baseline} in
  // {month}", with the fallback labelled per issue #700's own acceptance
  // criteria. Built in JS from small already-translated fragments rather
  // than one large ICU template, matching how `bookingsDetail`/`description`
  // above already choose between whole sentences in code: the branching
  // (percent vs. points vs. neither, year-ago vs. previous-month) is a
  // decision tree, not something ICU's own conditionals read clearly.
  const baselineMonthLabel = baselineMonth ? monthLabel(baselineMonth, locale) : null;
  function comparisonLine(trend: string | null, baselineText: string): string | undefined {
    if (!comparison || !baselineMonthLabel) return undefined;
    const key =
      comparison.kind === "yearAgo"
        ? "reports.comparison.yearAgo"
        : "reports.comparison.previousMonthFallback";
    return t(key, {
      trend: trend ? `${trend} ` : "",
      baseline: baselineText,
      month: baselineMonthLabel,
    });
  }
  const revenueComparison = comparison
    ? comparisonLine(
        comparison.revenueCents.percentChange !== null
          ? formatPercentChange(comparison.revenueCents.percentChange)
          : null,
        formatReportMoney(baselineReport?.revenueCents ?? 0, currency, locale),
      )
    : undefined;
  const tipsComparison = comparison
    ? comparisonLine(
        comparison.tipsCents.percentChange !== null
          ? formatPercentChange(comparison.tipsCents.percentChange)
          : null,
        formatReportMoney(baselineReport?.tipsCents ?? 0, currency, locale),
      )
    : undefined;
  const bookingsComparison = comparison
    ? comparisonLine(
        comparison.seatsBooked.percentChange !== null
          ? formatPercentChange(comparison.seatsBooked.percentChange)
          : null,
        String(comparison.seatsBooked.baseline),
      )
    : undefined;
  // Ratio cards need their own baseline to exist too, not merely a
  // comparison month with a report — a baseline month with zero seats
  // offered has nothing to measure fill against, and that absence must stay
  // absent rather than render as a manufactured "0%" (docs/design/principles.md).
  const fillComparison =
    comparison && comparison.fillRate.baseline !== null
      ? comparisonLine(
          comparison.fillRate.pointsChange !== null
            ? formatPointsChange(comparison.fillRate.pointsChange)
            : null,
          formatPercent(comparison.fillRate.baseline),
        )
      : undefined;
  const waiverComparison =
    comparison && comparison.waiverCompletion.baseline !== null
      ? comparisonLine(
          comparison.waiverCompletion.pointsChange !== null
            ? formatPointsChange(comparison.waiverCompletion.pointsChange)
            : null,
          formatPercent(comparison.waiverCompletion.baseline),
        )
      : undefined;

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
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.reports)}
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
              scroll={false}
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t("reports.earliestMonthTitle")}
              className={navDisabledClass}
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
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
              scroll={false}
            >
              <DiveDayIcon name="arrow-right" className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              title={t("reports.currentMonthTitle")}
              className={navDisabledClass}
            >
              <DiveDayIcon name="arrow-right" className="size-4" />
            </span>
          )}
        </nav>
      </div>

      {!hasMonthlyActivity ? (
        // A month with no departures is this page's rest state, not news about
        // it: `ShopNotice` is the vocabulary for something that *happened*
        // (a save, a refusal, a permission bounce), and wearing it here made an
        // ordinary quiet January read as a warning.
        <EmptyState title={isFuture ? t("reports.noTripsFuture") : t("reports.noTripsPast")} />
      ) : (
        <>
          {/* An owner sending an accountant this month's numbers used to have
              a screenshot — the full-shop export is the right tool for a
              bookkeeper, but the wrong one for "just this month" (issue
              #700). */}
          <div className="mb-4 flex justify-end">
            <a
              href={`/shop/${shopSlug}/reports/download?month=${monthKey(current)}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("reports.downloadCsv")}
            </a>
          </div>
          <section
            aria-label={t("reports.numbersLabel")}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <ShopStat
              label={t("reports.metrics.revenueLabel")}
              value={formatReportMoney(report.revenueCents, currency, locale)}
              detail={
                report.importedFinancialRecordCount > 0
                  ? t("reports.metrics.revenueDetailWithImported", {
                      count: report.importedFinancialRecordCount,
                      payments: formatReportMoney(report.importedPaymentCents, currency, locale),
                      refunds: formatReportMoney(report.importedRefundCents, currency, locale),
                    })
                  : t("reports.metrics.revenueDetail")
              }
              comparison={revenueComparison}
              linkHref={revenueOrdersHref}
              linkLabel={t("reports.metrics.revenueViewOrders")}
            />
            {/*
              Tips sit beside revenue rather than inside it (PAY-M2): they are
              their own Stripe charge, 100% to the shop, and never part of the
              booking payment gate. The imported-source note below separately
              names financial evidence that is not Stripe-confirmed, so nobody
              mistakes a useful migration total for a Stripe-dashboard match.
            */}
            <ShopStat
              label={t("reports.metrics.tipsLabel")}
              value={formatReportMoney(report.tipsCents, currency, locale)}
              detail={t("reports.metrics.tipsDetail", { count: report.tipCount })}
              comparison={tipsComparison}
            />
            <ShopStat
              label={t("reports.metrics.bookingsLabel")}
              value={String(report.seatsBooked)}
              detail={bookingsDetail}
              comparison={bookingsComparison}
            />
            <ShopStat
              label={t("reports.metrics.seatFillLabel")}
              value={formatPercent(report.fillRate)}
              detail={t("reports.metrics.seatFillDetail", {
                booked: report.seatsBooked,
                offered: report.seatsOffered,
                count: report.atCapacityTrips,
              })}
              comparison={fillComparison}
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
              comparison={waiverComparison}
            />
          </section>

          {report.importedFinancialRecordCount > 0 ? (
            <section aria-label={t("reports.importedHistory.sectionLabel")} className="mt-6">
              <ShopNotice tone="warning">
                <p className="font-medium">{t("reports.importedHistory.heading")}</p>
                <p className="mt-1 text-sm">
                  {t("reports.importedHistory.detail", {
                    payments: formatReportMoney(report.importedPaymentCents, currency, locale),
                    refunds: formatReportMoney(report.importedRefundCents, currency, locale),
                  })}
                </p>
                <Link
                  href={revenueOrdersHref}
                  className="mt-3 inline-block font-medium text-primary underline underline-offset-2"
                >
                  {t("reports.importedHistory.viewOrders")}
                </Link>
              </ShopNotice>
            </section>
          ) : null}

          {report.tripCount > 0 ? (
            <section aria-label={t("reports.tripsThisMonth")} className="mt-8">
              <h2 className="mb-3 text-lg font-semibold">{t("reports.tripsThisMonth")}</h2>
              <Table>
                <THead>
                  <Th>{t("reports.table.trip")}</Th>
                  <Th numeric hideBelow="sm">
                    {t("reports.table.seats")}
                  </Th>
                  <Th>{t("reports.table.fill")}</Th>
                  <Th numeric hideBelow="sm">
                    {t("reports.table.crew")}
                  </Th>
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
                        {/* No numeral: "70%" is arithmetic on the `7/12` in the
                            cell to its left, which the trip cell above repeats
                            on a phone where that column is hidden. Three
                            renderings of one number, twenty-one rows to a page
                            (§9 — cross out what repeats). The bar survives as
                            the scannable one and the fraction as the exact one. */}
                        <Td>
                          <ShareBar
                            ratio={tripFillRate(trip)}
                            label={t("reports.fillLabel", {
                              booked: trip.activeBookings,
                              capacity: trip.capacity,
                            })}
                          />
                        </Td>
                        {/* Never a cost — DiveDay does not know wages and must
                            not guess one. Just the fact a fill percentage alone
                            hides: a thin departure that still sailed with a
                            full crew (issue #700). */}
                        <Td numeric muted hideBelow="sm">
                          {crewCounts.get(trip.tripId) ?? 0}
                        </Td>
                        {/* This one keeps its numeral. Nothing else on the row
                            states how many waivers are in, so dropping it would
                            not be removing a duplicate — it would be removing
                            the fact. */}
                        <Td>
                          <ShareBar
                            ratio={waiverRatio}
                            value={formatPercent(waiverRatio)}
                            remainder="attention"
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
          ) : (
            <EmptyState title={t("reports.noTripsWithImportedHistory")} className="mt-8" />
          )}
        </>
      )}
    </main>
  );
}
