import Link from "next/link";
import type { ComponentProps } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { type MonthRef, monthLabel } from "@/lib/calendar";
import { DayJumpStrip } from "./DayJumpStrip";
import { MonthGrid } from "./MonthGrid";
import { MonthRail } from "./MonthRail";
import {
  type MonthWindow,
  monthGridWeekdays,
  monthGridWeeks,
  monthSpanLabel,
  weekStartsOnFor,
  windowGridWeeks,
} from "./month-grid";

/**
 * **The month rail and the calendar behind one icon** (issue #4379). The list is the default; the
 * button is only the month glyph, named for a screen reader, and swaps the day strip for the grid.
 */
export function MonthControls({
  t,
  locale,
  monthView,
  currentMonth,
  weekWindow = null,
  railShown,
  railSides,
  departures,
  dayKeyOf,
  weekRows,
  toggleHref,
}: {
  t: DiverTranslator;
  locale: string;
  monthView: boolean;
  currentMonth: MonthRef;
  /** The grid that starts on this week, or null for a chosen month drawn whole. */
  weekWindow?: MonthWindow | null;
  railShown: boolean;
  railSides: Pick<Parameters<typeof MonthRail>[0], "previous" | "next">;
  departures: readonly { startsAt: Date; capacity: number; booked: number }[];
  dayKeyOf: (date: Date) => string;
  weekRows: ComponentProps<typeof DayJumpStrip>["rows"];
  toggleHref: string;
}) {
  const weekStartsOn = weekStartsOnFor(locale);
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        {railShown ? (
          <MonthRail
            aria-label={t("schedule.monthNav")}
            month={
              weekWindow
                ? monthSpanLabel(weekWindow.first, weekWindow.last, locale)
                : monthLabel(currentMonth, locale)
            }
            className=""
            {...railSides}
          />
        ) : (
          <span />
        )}
        <Link
          href={toggleHref}
          aria-label={monthView ? t("schedule.listView") : t("schedule.monthView")}
          aria-pressed={monthView}
          scroll={false}
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
        >
          <DiveDayIcon name="month" className="size-4" />
        </Link>
      </div>
      {monthView ? (
        <MonthGrid
          label={t("schedule.monthCalendar")}
          weekdays={monthGridWeekdays(locale, weekStartsOn)}
          weeks={
            weekWindow
              ? windowGridWeeks(weekWindow, departures, dayKeyOf)
              : monthGridWeeks(currentMonth, departures, dayKeyOf, weekStartsOn)
          }
          roomLabel={(count) => t("schedule.boatsWithRoom", { count })}
          fullText={t("fallback.full")}
          linkedDays={new Set(weekRows.map((row) => row.dayKey))}
        />
      ) : (
        <DayJumpStrip rows={weekRows} label={t("schedule.jumpToDay")} />
      )}
    </>
  );
}
