import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { getShopById, upcomingTripsWithCounts } from "@/db/queries";
import { signOut } from "@/lib/auth";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Shop — Scuba",
};

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const session = await requireStaffSession();
  const { created } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const firstName = session.user.name?.split(" ")[0] ?? "there";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-muted">
            {upcoming.length === 0
              ? "Nothing on the books yet."
              : `${upcoming.length} upcoming ${upcoming.length === 1 ? "trip" : "trips"} on the schedule.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/shop/trips/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
          >
            Schedule a trip
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {created ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          “{created}” is on the board. 🤙
        </p>
      ) : null}

      {upcoming.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <h2 className="font-medium">No trips on the books</h2>
          <p className="mt-1 text-sm text-muted">
            Schedule your first charter and it&apos;ll show up here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {upcoming.map((trip) => (
            <li key={trip.id}>
              <Link
                href={`/shop/trips/${trip.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 className="font-medium">{trip.title}</h2>
                  <p className="text-sm text-muted">
                    {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
                    {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-muted tabular-nums">
                    {trip.booked} of {trip.capacity} booked
                  </span>
                  <span
                    className={
                      isFull(trip)
                        ? "inline-block rounded-full border border-border bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
                        : "inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
                    }
                  >
                    {capacityLabel(trip)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
