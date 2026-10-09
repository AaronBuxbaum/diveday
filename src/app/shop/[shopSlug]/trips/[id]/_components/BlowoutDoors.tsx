import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { shopPath } from "@/lib/staff-notices";

const DOOR_CLASS = buttonClass({ variant: "danger-ghost", size: "sm", flush: true });

/**
 * The departure's two doors to a weather call, in its More list: this boat
 * alone (ADR 20260804-blowout-cascade), or every boat of its day (ADR
 * 20261009-day-weather-call) — a front that closes the harbour closes it for
 * every boat that morning.
 *
 * Neither carries a caption, because the page each opens is one: its lead says
 * what calling it does, and it is the confirm.
 */
export function BlowoutDoors({
  shopSlug,
  tripId,
  startsAt,
  timeZone,
  tripLabel,
  dayLabel,
}: {
  shopSlug: string;
  tripId: string;
  startsAt: Date;
  timeZone: string;
  tripLabel: string;
  dayLabel: string;
}) {
  const day = calendarDateInTimezone(startsAt, timeZone);
  return (
    <>
      <Link href={shopPath(shopSlug, "schedule", "blowout", tripId)} className={DOOR_CLASS}>
        {tripLabel}
      </Link>
      <Link href={shopPath(shopSlug, "schedule", "blowout", "day", day)} className={DOOR_CLASS}>
        {dayLabel}
      </Link>
    </>
  );
}
