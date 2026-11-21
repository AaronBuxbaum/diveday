/** reporting public contract. Internals are imported only within this module. */

export type {
  ComparisonBaselineKind,
  MetricComparison,
  MonthComparison,
  MonthlyReport,
  MonthlyReportInput,
  RatioComparison,
  ReportTrip,
} from "./rules";
export {
  COUNT_SMALL_BASE,
  compareMetric,
  compareMonthlyReports,
  compareRatio,
  formatPercent,
  formatPercentChange,
  formatPointsChange,
  formatReportMoney,
  hasComparableBaseline,
  monthHasActivity,
  summarizeMonth,
  tripFillRate,
} from "./rules";
export type { CertifiedHere, CrewYear, MonthlyReportTripPage, WeekdayLeadTime } from "./store";
export {
  bookingLeadTimes,
  canPersonViewShopReports,
  certifiedHere,
  crewCountsByTrip,
  crewYearFacts,
  earliestImportedFinancialHistoryDate,
  earliestReportedTripStart,
  getMonthlyReport,
  getShopYear,
  getYearMonthInputs,
  getYearToDate,
  pagedMonthlyReportTrips,
  REPORT_TRIPS_PAGE_SIZE,
} from "./store";
