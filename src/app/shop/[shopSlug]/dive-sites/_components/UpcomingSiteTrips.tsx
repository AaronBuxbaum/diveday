import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { UpcomingSiteTrip } from "@/db/dive-sites";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";

/** Upcoming use remains available without standing ahead of the site's fields. */
export function UpcomingSiteTrips({
  trips,
  tideLineByTrip,
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  trips: readonly UpcomingSiteTrip[];
  tideLineByTrip: ReadonlyMap<string, string>;
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  return trips.length > 0 ? (
    <details className="group mt-6">
      <summary
        className={buttonClass({
          variant: "link",
          flush: true,
          className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {t("diveSites.edit.upcomingCount", { count: trips.length })}
        <DisclosureCaret direction="down" className="group-open:rotate-180" />
      </summary>
      <ul className="mt-2 divide-y divide-border border-y border-border">
        {trips.map((trip) => (
          <li key={trip.tripId} className="last:rounded-b-panel">
            <Link
              href={`/shop/${shopSlug}/trips/${trip.tripId}`}
              className="flex flex-col gap-1 rounded-[inherit] px-4 py-3 text-base hover:bg-surface-sunken focus-visible:focus-ring-inset sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3 sm:px-5"
            >
              <span className="font-medium">{trip.title}</span>
              <span className="text-muted">{formatShortDate(trip.startsAt, locale, timeZone)}</span>
              {tideLineByTrip.has(trip.tripId) ? (
                <span className="basis-full text-sm text-muted">{tideLineByTrip.get(trip.tripId)}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  ) : null;
}
