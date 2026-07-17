import type { Metadata } from "next";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getShopBySlug, upcomingTripsWithCounts } from "@/db/queries";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { capacityLabel, isFull } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Schedule — Scuba",
};

export default async function TripsPage() {
  await connection(); // schedule is live data — render per request, not at build
  const db = await getDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
        <p className="text-muted">No shop configured yet.</p>
      </main>
    );
  }
  const upcoming = await upcomingTripsWithCounts(db, shop.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <header className="mb-10">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Schedule</h1>
        <p className="mt-1 text-muted">Upcoming trips and charters.</p>
      </header>

      {upcoming.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <h2 className="font-medium">No trips on the books</h2>
          <p className="mt-1 text-sm text-muted">
            The ocean&apos;s still there — schedule your first charter to fill this page.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {upcoming.map((trip) => {
            const full = isFull(trip);
            return (
              <li
                key={trip.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 sm:flex-row sm:items-center"
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
                  {trip.description ? (
                    <p className="mt-0.5 text-sm text-muted">{trip.description}</p>
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
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
