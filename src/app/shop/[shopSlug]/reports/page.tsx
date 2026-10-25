import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getMonthDeparturesWithEmptySeats } from "@/db/open-seats";
import { getMonthMoneyDetail } from "@/db/report-lines";
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
import { formatMonthDay } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import {
  compareMonthlyReports,
  formatReportMoney,
  type MonthComparison,
  monthHasActivity,
  summarizeMonth,
} from "@/lib/reporting";
import { requireShopSurface } from "@/lib/session";
import { sameMomentYearBefore, shopMonthBounds, utcToWallTime } from "@/lib/zoned";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { DepartureLedger, departureLedgerRows } from "./_components/DepartureLedger";
import { DepartureMoney } from "./_components/DepartureMoney";
import { EmptySeats } from "./_components/EmptySeats";
import { MonthDays } from "./_components/MonthDays";
import { MonthFigures } from "./_components/MonthFigures";
import {
  BuddyReferrerLines,
  MoneyByLine,
  MonthDetailLines,
  MonthFootnotes,
  MonthPayouts,
  QuietMonth,
} from "./_components/MonthMoneyDetail";
import { LeadTimes, readMonthOwner, WeatherLine } from "./_components/MonthOwnerLines";
import { monthFigureBasis, monthFigureList } from "./_components/month-figure-list";
import { ReportExportMenu } from "./_components/ReportExportMenu";
import { ReportRangeTabs } from "./_components/ReportRangeTabs";
import { YearView } from "./_components/YearView";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Reports — DiveDay",
};

function earlierMonth(left: MonthRef, right: MonthRef): MonthRef {
  return compareMonths(left, right) > 0 ? right : left;
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
 * both deletion queues to Settings' "Data" group. Nothing on
 * this page is actionable now except the month you are looking at and the
 * revenue figure's jump into Orders.
 *
 * **The chrome went the same way** (ADR 20260827-the-shops-shelves, decision
 * 3): six bordered stat tiles over a five-column table are five unboxed
 * figures over a ledger — `_components/MonthFigures.tsx` and
 * `_components/DepartureLedger.tsx`, which carry the reasoning for each. Every
 * number the page had it still has; what it stopped doing is drawing a box
 * round each one. The month arithmetic, the picker's floor, the baseline
 * choice and the CSV are untouched.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; page?: string; range?: string; year?: string }>;
}) {
  const { shopSlug } = await params;
  const { month, page, range, year } = await searchParams;
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
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const tz = shop.timezone;
  const now = nowDate();

  // **The year is the other reading of the same page** (ADR 20260908-one-hand,
  // decision 6, lever T). One segmented control chooses between them and the
  // month below is untouched — same route, same gate, same locale, and a
  // reader who never taps "This year" sees exactly the page they had.
  //
  // The branch is here rather than at a route of its own because the two are
  // one destination: a second `/reports/year` page would need its own entry in
  // the staff registry, its own `loading.tsx` and its own eyebrow, to say the
  // same word twice.
  if (range === "year") {
    return (
      <YearView
        {...{ db, shop, shopSlug, locale, now, t }}
        roles={session.user.roles}
        requestedYear={year}
      />
    );
  }

  // Revenue is this shop's own money — a Bali shop's month reads in rupiah
  // (docs ADR 20260731-shop-currency). Note the fill/waiver percentages below
  // are ratios, not money, and stay currency-free.
  const currency = toShopCurrency(shop.currency);
  const todayWall = utcToWallTime(now, tz);
  const thisMonth: MonthRef = { year: todayWall.year, month: todayWall.month };
  // The oldest month this shop could have anything to report on. It is the
  // floor of the back arrow and of a hand-edited `?month=`: walking further back only ever
  // renders identical empty months, and `?month=0001-01` should land somewhere
  // real rather than querying the year 1. An imported payment/refund is a
  // genuine financial fact even without a DiveDay departure, so its earliest
  // eligible source day also moves this floor.
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

  const { from: monthStart, to: monthEnd } = shopMonthBounds(current, tz);
  // The revenue card's "View orders" link (task 158): the report's month as the Orders filter.
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

  // Totals see every trip in the month (a page-limited fill rate would quietly go wrong); the
  // table below gets its own bounded slice, and the baseline month the same shape of query.
  //
  // **By this date last year** (fifth loop, item 25): while this month is under
  // way, its year-ago baseline is read only to the same wall-clock moment, so
  // a half month is never set against a whole one.
  const underWay = monthStart < now && now < monthEnd;
  const toDate = underWay && baselineKind === "yearAgo";
  const baselineWindow = baselineMonth
    ? {
        start: shopMonthBounds(baselineMonth, tz).from,
        end: toDate ? sameMomentYearBefore(now, tz) : shopMonthBounds(baselineMonth, tz).to,
      }
    : null;
  // Both months ride one Promise.all; the month under way also reads its sailed half (item 22).
  const shopMoney = { currency, timeZone: tz };
  const [input, tripPage, baselineInput, moneyDetail, emptySeats, sailedInput, owner] =
    await Promise.all([
      getMonthlyReport(db, shop.id, monthStart, monthEnd, shopMoney),
      // A non-numeric or missing `?page=` reads as page 1; the query clamps it
      // into range, so switching to a shorter month never strands the reader on
      // a page that month does not have.
      pagedMonthlyReportTrips(db, shop.id, monthStart, monthEnd, {
        page: Number.parseInt(page ?? "", 10),
      }),
      baselineWindow
        ? getMonthlyReport(db, shop.id, baselineWindow.start, baselineWindow.end, shopMoney)
        : Promise.resolve(null),
      // The money by line, the package dives still owed, and the returning
      // divers (owner decision 2026-10-09) — `src/lib/report-lines.ts`.
      getMonthMoneyDetail(db, shop.id, monthStart, monthEnd, now, shopMoney, current),
      // The departures that left with empty seats (issue #2424), on the debrief's own rule.
      getMonthDeparturesWithEmptySeats(
        db,
        shop.id,
        { startUtc: monthStart, endUtc: monthEnd },
        now,
      ),
      underWay ? getMonthlyReport(db, shop.id, monthStart, now, shopMoney) : null,
      // The weather's month (fifth loop, item 27).
      readMonthOwner(db, shop, { startUtc: monthStart, endUtc: monthEnd }),
    ]);
  const report = summarizeMonth(input);
  const money = (cents: number) => formatReportMoney(cents, currency, locale);
  const sailedReport = sailedInput ? summarizeMonth(sailedInput) : null;
  const baselineReport = baselineInput ? summarizeMonth(baselineInput) : null;
  // To date, what has sailed is what last year's same days are set against.
  const compared = toDate && sailedReport ? sailedReport : report;
  const comparison: MonthComparison | null =
    baselineReport && baselineKind
      ? compareMonthlyReports(baselineKind, compared, baselineReport, currency)
      : null;
  const { trips } = tripPage;
  const hasMonthlyActivity = monthHasActivity(report);
  // How many crew were assigned per departure on this page — the number
  // only, never a cost (issue #700). Scoped to the ledger's own page of
  // trips, the same bound every other per-trip figure on this page already
  // keeps to.
  const crewCounts = trips.length
    ? await crewCountsByTrip(
        db,
        shop.id,
        trips.map((trip) => trip.tripId),
      )
    : new Map<string, number>();

  const baselineMonthLabel = baselineMonth ? monthLabel(baselineMonth, locale) : null;

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

  // A square 44px target holding one glyph, through the shared `size: "icon"`
  // rather than a hand-spelled `size-11` — this pair was one of the four
  // spellings that size exists to end (see components/ui/button.ts). Plain
  // `secondary`, with no `text-foreground` override: two `text-<color>`
  // utilities resolve by stylesheet order rather than by the order they are
  // written, and `globals.css` declares `--color-primary` after
  // `--color-foreground`, so an override there is inert.
  const navClass = buttonClass({ variant: "secondary", size: "icon" });
  // The far edge of the range: decorative and `aria-hidden`, so it wears the
  // same box and is made inert rather than merely restyled. `pointer-events-none`
  // and not `cursor-default` — the shared base carries `cursor-pointer`, which
  // wins by the same ordering rule, and this also stops the hover background
  // lighting up an arrow that goes nowhere.
  const navDisabledClass = `${navClass} pointer-events-none opacity-40`;

  const figures = monthFigureList({
    report,
    baselineReport,
    comparison,
    baselineMonthLabel,
    toDateDay: toDate ? formatMonthDay(todayWall.month, todayWall.day, locale) : null,
    currency,
    locale,
    t,
  });
  const figureBasis = monthFigureBasis({ report, currency, locale, t });
  const currentMonthKey = monthKey(current);

  const departureRows = departureLedgerRows({
    trips,
    crewCounts,
    netByTrip: new Map(input.trips.map((trip) => [trip.tripId, trip.netCents ?? 0])),
    money,
    shopSlug,
    locale,
    timeZone: tz,
    t,
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        title={t("shared.shopSections.money")}
        // The month's three files, one menu (visual review A06).
        actions={
          hasMonthlyActivity ? (
            <ReportExportMenu t={t} shopSlug={shopSlug} month={currentMonthKey} />
          ) : undefined
        }
      />
      <StaffSectionTabs
        section="money"
        current="reports"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      <ReportRangeTabs shopSlug={shopSlug} range="month" t={t} className="mb-6" />

      {/*
        Month navigator — the period between its two arrows, and nothing else
        (UX review 2026-10-10, item 32). The arrows are links, so a tap is the
        change; the month list that sat between them was a third control for
        the same choice. The This month / This year switch above stays because
        the year is its own report, not a further month. The arrows are 48px
        `icon` squares.
      */}
      <nav aria-label={t("reports.chooseMonth")} className="mb-6 flex items-center gap-3">
        {prevMonthKey ? (
          <Link
            href={`/shop/${shopSlug}/reports?month=${prevMonthKey}`}
            aria-label={t("reports.previousMonth")}
            className={`${navClass} shrink-0`}
            scroll={false}
          >
            <DiveDayIcon name="arrow-left" className="size-4" />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            title={t("reports.earliestMonthTitle")}
            className={`${navDisabledClass} shrink-0`}
          >
            <DiveDayIcon name="arrow-left" className="size-4" />
          </span>
        )}
        <h2 className={`${SECTION_TITLE_CLASS} min-w-0 tabular-nums`}>
          {monthLabel(current, locale)}
          {isThisMonth ? (
            <span className="ms-2 text-sm font-normal text-muted">{t("reports.soFar")}</span>
          ) : null}
        </h2>
        {nextMonthKey ? (
          <Link
            href={`/shop/${shopSlug}/reports?month=${nextMonthKey}`}
            aria-label={t("reports.nextMonth")}
            className={`${navClass} shrink-0`}
            scroll={false}
          >
            <DiveDayIcon name="arrow-right" className="size-4" />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            title={t("reports.currentMonthTitle")}
            className={`${navDisabledClass} shrink-0`}
          >
            <DiveDayIcon name="arrow-right" className="size-4" />
          </span>
        )}
      </nav>

      {!hasMonthlyActivity ? (
        <QuietMonth
          title={isFuture ? t("reports.noTripsFuture") : t("reports.noTripsPast")}
          detail={moneyDetail}
          t={t}
          money={money}
        />
      ) : (
        <>
          <MonthDays {...{ db, now, locale, t }} shopId={shop.id} timeZone={tz} month={current} />
          <MonthFigures label={t("reports.numbersLabel")} figures={figures} caption={figureBasis} />

          <MonthFootnotes
            taxCents={report.taxCents}
            counterTaxIncludedCents={moneyDetail.counterTaxIncludedCents}
            {...{ t, money }}
          />
          <WeatherLine weather={owner.weather} t={t} money={money} />

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
                  className={`${tapTargetLinkClass} mt-3 font-medium text-primary underline underline-offset-2`}
                >
                  {t("reports.importedHistory.viewOrders")}
                </Link>
              </ShopNotice>
            </section>
          ) : null}

          <MonthDetailLines report={report} detail={moneyDetail} t={t} money={money} />
          <BuddyReferrerLines detail={moneyDetail} t={t} shopSlug={shopSlug} />
          <MoneyByLine detail={moneyDetail} t={t} money={money} />
          <MonthPayouts detail={moneyDetail} t={t} locale={locale} timeZone={tz} />
          <EmptySeats
            summary={emptySeats}
            shopSlug={shopSlug}
            t={t}
            locale={locale}
            timeZone={tz}
          />

          <DepartureMoney trips={input.trips} timeZone={tz} t={t} money={money} />
          {report.tripCount > 0 ? (
            <DepartureLedger
              className="mt-10"
              label={t("reports.tripsThisMonth")}
              labelId="reports-departures"
              count={t("reports.pagination.total", { count: tripPage.total })}
              rows={departureRows}
              pager={
                <Pager
                  page={tripPage.page}
                  pageCount={tripPage.pageCount}
                  href={(target) =>
                    `/shop/${shopSlug}/reports?month=${monthKey(current)}${
                      target > 1 ? `&page=${target}` : ""
                    }`
                  }
                  words={staffPagerWords(t)}
                />
              }
            />
          ) : (
            <EmptyState title={t("reports.noTripsWithImportedHistory")} className="mt-8" />
          )}
          <LeadTimes db={db} shopId={shop.id} timeZone={tz} now={now} locale={locale} t={t} />
        </>
      )}
    </main>
  );
}
