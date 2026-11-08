import { compareMonths, type MonthRef } from "@/lib/calendar";
import { utcToWallTime } from "@/lib/zoned";

/** Native departures and imported financial dates share the report picker's floor. */
export function reportFloorMonth({
  earliestTripStart,
  earliestImportedFinancialDate,
  thisMonth,
  timeZone,
}: {
  earliestTripStart: Date | null;
  earliestImportedFinancialDate: string | null;
  thisMonth: MonthRef;
  timeZone: string;
}): MonthRef {
  const earliestWall = earliestTripStart ? utcToWallTime(earliestTripStart, timeZone) : null;
  const earliestTripMonth = earliestWall
    ? { year: earliestWall.year, month: earliestWall.month }
    : thisMonth;
  const earliestImportedMonth = earliestImportedFinancialDate
    ? {
        year: Number(earliestImportedFinancialDate.slice(0, 4)),
        month: Number(earliestImportedFinancialDate.slice(5, 7)),
      }
    : thisMonth;
  return [earliestTripMonth, earliestImportedMonth, thisMonth].reduce(
    (left, right) => (compareMonths(left, right) > 0 ? right : left),
    thisMonth,
  );
}
