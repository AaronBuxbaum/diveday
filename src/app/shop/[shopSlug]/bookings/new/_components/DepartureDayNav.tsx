import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { DateField, Field } from "@/components/ui/form";
import type { CalendarDate } from "@/lib/calendar-date";

/**
 * **Which days the picker shows, and the way to any other** (UX audit
 * 2026-10-07, item 19). The picker opens on today and tomorrow
 * (`departurePickerWindow`); a caller asking for the 23rd is one date away
 * rather than three pages of departures away.
 *
 * A plain GET form, so it works before React owns the page and the chosen day
 * is a URL a staffer can come back to. A date request being booked rides
 * along as a hidden field, the way every other link on the page carries it.
 * Words come from the page: this renders on the server and holds no copy.
 */
export function DepartureDayNav({
  action,
  day,
  today,
  request,
  words,
  className = "",
}: {
  /** The page's own path, without a query. */
  action: string;
  day: CalendarDate;
  today: CalendarDate;
  request: string | null;
  words: { dayLabel: string; show: string };
  className?: string;
}) {
  return (
    <form action={action} method="get" className={`flex items-end gap-2 ${className}`}>
      {request ? <input type="hidden" name="request" value={request} /> : null}
      <Field label={words.dayLabel} markRequired={false} className="w-44">
        <DateField name="from" defaultValue={day} min={today} required />
      </Field>
      <button type="submit" className={buttonClass({ variant: "secondary" })}>
        {words.show}
      </button>
    </form>
  );
}

/**
 * The two steps through the days, under the list the way a pager sits under
 * a page: a staffer reads today and tomorrow first and only then wants the
 * next two. Earlier days only once the window has left today.
 */
export function DepartureDaySteps({
  earlierHref,
  laterHref,
  words,
  className = "",
}: {
  earlierHref: string | null;
  laterHref: string;
  words: { earlier: string; later: string };
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      {earlierHref ? (
        <Link href={earlierHref} className={buttonClass({ variant: "secondary" })}>
          {words.earlier}
        </Link>
      ) : (
        <span />
      )}
      <Link href={laterHref} className={buttonClass({ variant: "secondary" })}>
        {words.later}
      </Link>
    </div>
  );
}
