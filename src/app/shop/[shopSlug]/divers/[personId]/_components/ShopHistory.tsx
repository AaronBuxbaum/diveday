import Link from "next/link";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import type { DiverProfile, Shop } from "./shared";

export function ShopHistory({
  diver,
  shop,
  shopSlug,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
}) {
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="history-heading">
      <h2 id="history-heading" className="text-lg font-semibold">
        Shop history
      </h2>
      {diver.bookings.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          No trips yet — book them onto an open charter and it’ll show up here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {diver.bookings.map(({ booking, trip, course }) => (
            <li
              key={booking.id}
              className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <Link
                  href={`/shop/${shopSlug}/trips/${trip.id}`}
                  className="font-medium hover:text-primary hover:underline"
                >
                  {trip.title}
                </Link>
                <p className="text-sm text-muted">
                  {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
                  {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
                  {course ? ` · ${course.title}` : ""}
                </p>
              </div>
              <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm text-muted">
                {booking.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
