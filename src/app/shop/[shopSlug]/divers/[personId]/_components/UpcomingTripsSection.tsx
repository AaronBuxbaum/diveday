import Link from "next/link";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import type { DiverProfile, Shop } from "./shared";

type Booking = DiverProfile["bookings"][number];

/** This diver's still-scheduled departures — "which boats is this person on this week?" */
function upcomingBookings(bookings: readonly Booking[], now: Date): Booking[] {
  return bookings
    .filter(
      ({ booking, trip }) =>
        trip.status === "scheduled" && booking.status !== "cancelled" && trip.startsAt >= now,
    )
    .sort((a, b) => a.trip.startsAt.getTime() - b.trip.startsAt.getTime());
}

/**
 * A dedicated "what's coming up" list, above the full history — the history
 * below merges every booking (past and future) with imported prior visits and
 * links each row to the trip overview; this list is scoped to what's still
 * ahead and links straight to the manifest, since that's where staff go to do
 * something about an upcoming boat.
 */
export function UpcomingTripsSection({
  diver,
  shop,
  shopSlug,
  locale,
  now = nowDate(),
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  locale: string;
  now?: Date;
}) {
  const t = staffTranslator(locale);
  const upcoming = upcomingBookings(diver.bookings, now);
  if (upcoming.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="upcoming-trips-heading">
      <h2 id="upcoming-trips-heading" className="text-lg font-semibold">
        {t("divers.upcoming.heading")}
      </h2>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {upcoming.map(({ trip, course }) => (
          <li key={trip.id}>
            <Link
              href={`/shop/${shopSlug}/trips/${trip.id}/manifest`}
              className="flex flex-col gap-1 px-4 py-3 hover:bg-surface-sunken sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-medium">{trip.title}</span>
              <span className="text-sm text-muted">
                {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                {course ? ` · ${course.title}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
