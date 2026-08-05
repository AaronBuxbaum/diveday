import Link from "next/link";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { BookingMoneyCell } from "./BookingMoneyCell";
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
 * What's still ahead for this diver.
 *
 * This page used to list the same bookings three times over — here, again in
 * Payments (a row per booking, whether or not money was involved), and again in
 * the full history below. A staffer scrolling it read the same Saturday charter
 * three times and had to work out what was different about each telling.
 *
 * Now a booking appears exactly once, in whichever of two lists it belongs to:
 * this one while it is ahead, the history below once it is behind. The money
 * state rides on the row, because "is Saturday paid?" is a question about
 * Saturday — and Payments keeps only what is genuinely its own, the orders.
 *
 * Rows link to the manifest, not the trip overview: what staff come here to do
 * about an upcoming boat happens on the manifest.
 */
export function UpcomingTripsSection({
  diver,
  shop,
  shopSlug,
  personId,
  locale,
  paymentsConnected,
  now = nowDate(),
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  paymentsConnected: boolean;
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
        {upcoming.map(({ booking, trip, course }) => (
          // The row is no longer one big `<Link>`: it carries a billing link of
          // its own now, and an anchor inside an anchor is invalid markup that
          // keyboard and screen-reader users pay for first.
          <li
            key={trip.id}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <Link
                href={`/shop/${shopSlug}/trips/${trip.id}/manifest`}
                className="font-medium hover:text-primary hover:underline"
              >
                {trip.title}
              </Link>
              <p className="text-sm text-muted">
                {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
                {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                {course ? ` · ${course.title}` : ""}
              </p>
            </div>
            <BookingMoneyCell
              diver={diver}
              bookingId={booking.id}
              shopSlug={shopSlug}
              personId={personId}
              paymentsConnected={paymentsConnected}
              t={t}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
