import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { getShopBySlug, upcomingTripsWithCounts } from "@/db/queries";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { capacityLabel, isFull } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Schedule — Scuba",
};

export default async function TripsPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) {
    notFound();
  }
  const upcoming = await upcomingTripsWithCounts(db, shop.id);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={shop.name}
        title="Schedule"
        description="Upcoming trips and charters. Open a departure to work through its roster, readiness, gear, and manifest."
        actions={
          <Link
            href={`/shop/${shopSlug}/trips/new`}
            className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <span aria-hidden="true">+</span> Schedule a trip
          </Link>
        }
      />
      <section aria-label="Schedule snapshot" className="mb-8 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label="Departures"
          value={upcoming.length}
          detail="Upcoming trips and sessions"
          tone="primary"
        />
        <ShopStat
          label="Open seats"
          value={upcoming.reduce(
            (total, trip) => total + Math.max(0, trip.capacity - trip.booked),
            0,
          )}
          detail="Available across the board"
          tone="success"
        />
        <ShopStat
          label="At capacity"
          value={upcoming.filter(isFull).length}
          detail="Trips with no open seats"
        />
      </section>

      {upcoming.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <h2 className="font-medium">No trips on the books yet</h2>
          <p className="mt-1 text-sm text-muted">
            Check back soon — or call the shop and we&apos;ll find you a boat.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {upcoming.map((trip) => {
            const full = isFull(trip);
            return (
              <li key={trip.id}>
                <Link
                  href={`/shop/${shopSlug}/schedule/${trip.id}`}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 sm:flex-row sm:items-center"
                >
                  <div className="shrink-0 sm:w-32">
                    <p className="font-medium">
                      {formatShortDate(trip.startsAt, "en-US", shop.timezone)}
                    </p>
                    <p className="text-sm text-muted">
                      {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-medium group-hover:text-primary">{trip.title}</h2>
                    {trip.course ? (
                      <p className="mt-0.5 text-sm font-medium text-primary">
                        Course session · {trip.course.title}
                      </p>
                    ) : null}
                    {trip.description ? (
                      <p className="mt-0.5 text-sm text-muted">{trip.description}</p>
                    ) : null}
                    {trip.priceCents !== null ? (
                      <p className="mt-2 text-sm font-semibold tabular-nums">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                        }).format(trip.priceCents / 100)}{" "}
                        <span className="font-normal text-muted">per diver</span>
                      </p>
                    ) : null}
                    {trip.diveSite ? (
                      <p className="mt-2 text-sm font-medium text-primary">
                        Dive site · {trip.diveSite.name}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm text-muted">
                      {trip.plannedDives === 2 ? "Two-tank trip" : `${trip.plannedDives} dives`}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <span
                      className={
                        full
                          ? "inline-block rounded-full border border-border bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
                          : "inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
                      }
                    >
                      {capacityLabel(trip)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
