import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import { getBlockerQueue } from "@/db/blockers";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import type { BlockerQueueTrip } from "@/lib/blockers";
import { distinctBlockedDivers, waiverBookingIds } from "@/lib/blockers";
import { formatDateTimeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Blockers — DiveDay",
};

function DiverRow({
  diver,
  shopSlug,
}: {
  diver: BlockerQueueTrip["divers"][number];
  shopSlug: string;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:px-5">
      <div className="min-w-0">
        <p className="font-semibold">{diver.fullName}</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-base text-muted">
          {diver.blockers.map((blocker) => (
            <li key={blocker.code} className="flex gap-2">
              <span aria-hidden="true" className="text-danger">
                •
              </span>
              <span>{blocker.message}</span>
            </li>
          ))}
        </ul>
        {diver.alsoOn.length > 0 ? (
          <p className="mt-1.5 text-sm text-muted">
            Also blocked on {diver.alsoOn.join(", ")} — same diver, fix once.
          </p>
        ) : null}
      </div>
      {diver.fix.sendsWaiver ? (
        <WaiverSendControl
          shopSlug={shopSlug}
          surface="blockers"
          bookingIds={[diver.fix.bookingId]}
          label={diver.fix.label}
        />
      ) : (
        <Link
          href={diver.fix.href}
          className={buttonClass({ variant: "secondary", className: "shrink-0" })}
        >
          {diver.fix.label}
        </Link>
      )}
    </li>
  );
}

function TripGroup({
  trip,
  shopSlug,
  timeZone,
}: {
  trip: BlockerQueueTrip;
  shopSlug: string;
  timeZone: string;
}) {
  const batchIds = waiverBookingIds(trip);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-sunken px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/shop/${shopSlug}/trips/${trip.tripId}`}
              className="font-semibold hover:text-primary hover:underline"
            >
              {trip.title}
            </Link>
            {trip.courseTitle ? (
              <span className="text-sm font-medium text-primary">· {trip.courseTitle}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted">{formatDateTimeTz(trip.startsAt, "en-US", timeZone)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <span className="rounded-full bg-surface px-3 py-1 text-sm font-semibold tabular-nums">
            {trip.divers.length} of {trip.booked} blocked
          </span>
          {batchIds.length > 1 ? (
            <WaiverSendControl
              shopSlug={shopSlug}
              surface="blockers"
              bookingIds={batchIds}
              label={`Send all ${batchIds.length} waivers`}
              pendingLabel="Sending all…"
            />
          ) : null}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {trip.divers.map((diver) => (
          <DiverRow key={diver.bookingId} diver={diver} shopSlug={shopSlug} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The blocker queue: every diver who can't board yet, across all upcoming
 * departures, each with the one tap that clears them. Today answers "what needs
 * me before today's boats"; this answers "who isn't ready on any boat" so the
 * front desk can work the whole week ahead in one place.
 */
export default async function BlockersPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();

  const { trips, truncated } = await getBlockerQueue(db, shop.id, shopSlug);
  const blocked = distinctBlockedDivers(trips);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Front desk"
        title="Blockers"
        description={
          blocked === 0
            ? "Everyone booked on an upcoming departure is ready to board."
            : `${blocked} ${blocked === 1 ? "diver" : "divers"} across ${trips.length} ${
                trips.length === 1 ? "departure" : "departures"
              } can’t board yet. Clearing a row takes you straight to the fix.`
        }
      />

      {trips.length === 0 ? (
        <section className="rounded-3xl border border-border bg-surface-sunken p-8 text-center sm:p-10">
          <div
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface text-2xl"
            aria-hidden="true"
          >
            🤿
          </div>
          <h2 className="mt-4 text-lg font-semibold">Every boat is boarding-ready</h2>
          <p className="mx-auto mt-1 max-w-md text-muted">
            No upcoming diver is waiting on a waiver, a card, or a payment. New bookings show up
            here the moment something needs a hand.
          </p>
          <Link href={`/shop/${shopSlug}/schedule`} className={buttonClass({ className: "mt-5" })}>
            View the schedule
          </Link>
        </section>
      ) : (
        <div className="flex flex-col gap-5">
          {trips.map((trip) => (
            <TripGroup key={trip.tripId} trip={trip} shopSlug={shopSlug} timeZone={shop.timezone} />
          ))}
          {truncated ? (
            <p className="text-center text-sm text-muted">
              Showing the nearest 40 departures. Anything further out lives on the{" "}
              <Link
                href={`/shop/${shopSlug}/schedule`}
                className="font-medium text-primary hover:underline"
              >
                schedule
              </Link>
              .
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
