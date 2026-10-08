import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import type { DeparturePickerWindow } from "@/lib/departure-picker-window";
import { DepartureDayNav, DepartureDaySteps } from "./DepartureDayNav";
import { DeparturePicker, type DeparturePickerDay } from "./DeparturePicker";

/**
 * **The departures in the picker's window, and the ways to another window**
 * (UX audit 2026-10-07, item 19): the day control, the days themselves or the
 * next open seat when the window holds none, and Earlier / Later days under
 * the list.
 *
 * Every link keeps the date request being booked, and a window's own `from`
 * drops out of the URL when it is today, so the default view has one address.
 */
export function DepartureWindowSection({
  self,
  pickerWindow,
  requestId,
  days,
  tripPage,
  nextOpenDay,
  boardHref,
  locale,
  t,
}: {
  /** This page's own path, which every control here lands back on. */
  self: string;
  pickerWindow: DeparturePickerWindow;
  requestId: string | null;
  days: DeparturePickerDay[];
  tripPage: { page: number; pageCount: number; total: number };
  /** The next day with an open seat, when this window holds none. */
  nextOpenDay: CalendarDate | null;
  boardHref: string;
  locale: string;
  t: StaffTranslator;
}) {
  /** This page with a day and a page, the request being booked carried along. */
  const pickerHref = (target: { from?: string | null; page?: number }) => {
    const query = new URLSearchParams();
    if (requestId) query.set("request", requestId);
    if (target.from && target.from !== pickerWindow.today) query.set("from", target.from);
    if ((target.page ?? 1) > 1) query.set("page", String(target.page));
    const encoded = query.toString();
    return encoded ? `${self}?${encoded}` : self;
  };

  // The list is filtered to departures with a seat left, and a filter nobody
  // announced reads as a missing departure: a sold-out Saturday simply wasn't
  // here, with nothing on screen to say why or what to do about it. The
  // picker says both, and names the board as the place to do something
  // about it.
  if (days.length === 0 && !nextOpenDay) {
    return (
      <EmptyState
        title={t("bookings.new.tripEmpty")}
        action={
          <Link href={boardHref} className={buttonClass()}>
            {t("bookings.new.tripEmptyAction")}
          </Link>
        }
        className="mt-8"
      />
    );
  }

  return (
    <>
      <DepartureDayNav
        className="mt-8"
        action={self}
        day={pickerWindow.day}
        today={pickerWindow.today}
        request={requestId}
        words={{ dayLabel: t("bookings.new.day.label"), show: t("bookings.new.day.show") }}
      />
      {days.length === 0 && nextOpenDay ? (
        <EmptyState
          title={t("bookings.new.day.empty")}
          action={
            <Link href={pickerHref({ from: nextOpenDay })} className={buttonClass()}>
              {t("bookings.new.day.nextOpen", { date: formatCalendarDate(nextOpenDay, locale) })}
            </Link>
          }
          className="mt-6"
        />
      ) : (
        <>
          <DeparturePicker
            className="mt-6"
            heading={t("bookings.new.tripHeading")}
            headingId="which-departure"
            days={days}
          />
          <Pager
            page={tripPage.page}
            pageCount={tripPage.pageCount}
            href={(target) => pickerHref({ from: pickerWindow.day, page: target })}
            total={t("bookings.new.pagination.total", { count: tripPage.total })}
            words={staffPagerWords(t)}
          />
        </>
      )}
      <DepartureDaySteps
        className="mt-6"
        earlierHref={pickerWindow.earlier ? pickerHref({ from: pickerWindow.earlier }) : null}
        laterHref={pickerHref({ from: pickerWindow.later })}
        words={{ earlier: t("bookings.new.day.earlier"), later: t("bookings.new.day.later") }}
      />
      {/* Under the list rather than over it: it explains an absence, and an
          absence is only noticed once the reader has looked for it. */}
      <p className="mt-4 text-sm text-muted">{t("bookings.new.fullExcluded")}</p>
    </>
  );
}
