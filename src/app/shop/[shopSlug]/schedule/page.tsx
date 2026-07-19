import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <header className="mb-10">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Schedule</h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted">Upcoming trips and charters.</p>
          <Link
            href={`/shop/${shopSlug}/trips/new`}
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Schedule a trip
          </Link>
        </div>
      </header>

      {upcoming.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <h2 className="font-medium">No trips on the books yet</h2>
          <p className="mt-1 text-sm text-muted">
            Check back soon — or call the shop and we&apos;ll find you a boat.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {upcoming.map((trip) => {
            const full = isFull(trip);
            return (
              <li key={trip.id}>
                <Link
                  href={`/shop/${shopSlug}/schedule/${trip.id}`}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-primary/40 sm:flex-row sm:items-center"
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
                    <h2 className="font-medium">{trip.title}</h2>
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
