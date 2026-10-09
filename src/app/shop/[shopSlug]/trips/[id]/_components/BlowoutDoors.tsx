import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { canPersonCallDayBlowout } from "@/db/authz";
import { getDb } from "@/db/client";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { shopPath } from "@/lib/staff-notices";

const DOOR_CLASS = buttonClass({ variant: "danger-ghost", size: "sm", flush: true });

/**
 * The departure's two doors to a weather call, in its More list: this boat
 * alone (ADR 20260804-blowout-cascade), or every boat of its day (ADR
 * 20261009-day-weather-call) — a front that closes the harbour closes it for
 * every boat that morning. The day door shows only to the roles that may call
 * a whole day (`canCallDayBlowout`: owner, manager, captain).
 *
 * Neither carries a caption, because the page each opens is one: its lead says
 * what calling it does, and it is the confirm.
 */
export async function BlowoutDoors({
  shop,
  personId,
  tripId,
  startsAt,
  tripLabel,
  dayLabel,
}: {
  shop: { id: string; slug: string; timezone: string };
  personId: string;
  tripId: string;
  startsAt: Date;
  tripLabel: string;
  dayLabel: string;
}) {
  const day = calendarDateInTimezone(startsAt, shop.timezone);
  const canCallDay = await canPersonCallDayBlowout(await getDb(), shop.id, personId);
  return (
    <>
      <Link href={shopPath(shop.slug, "schedule", "blowout", tripId)} className={DOOR_CLASS}>
        {tripLabel}
      </Link>
      {canCallDay ? (
        <Link href={shopPath(shop.slug, "schedule", "blowout", "day", day)} className={DOOR_CLASS}>
          {dayLabel}
        </Link>
      ) : null}
    </>
  );
}
