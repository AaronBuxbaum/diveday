import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopStat } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { getTripManifest } from "@/db/manifests";
import { listNotificationDeliveryIssues, retryBookingConfirmation } from "@/db/notifications";
import { getShopById, upcomingTripsWithCounts } from "@/db/queries";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { capacityLabel, isFull } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Shop — Scuba",
};

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ created?: string; reset?: string; email?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { created, reset, email } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [upcoming, deliveryIssues] = await Promise.all([
    upcomingTripsWithCounts(db, shop.id),
    listNotificationDeliveryIssues(db, shop.id),
  ]);
  const nextManifest = upcoming[0] ? await getTripManifest(db, shop.id, upcoming[0].id) : null;
  const firstName = session.user.name?.split(" ")[0] ?? "there";
  const openSeats = upcoming.reduce(
    (total, trip) => total + Math.max(0, trip.capacity - trip.booked),
    0,
  );
  const fullTrips = upcoming.filter(isFull).length;

  async function retryConfirmationAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const bookingId = String(formData.get("bookingId") ?? "");
    const delivery = bookingId
      ? await retryBookingConfirmation(await getDb(), staff.user.shopId, bookingId)
      : null;
    redirect(
      `/shop/${staff.user.shopSlug}?email=${delivery?.status === "sent" ? "sent" : "failed"}`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["created", "reset", "email"]} />
      <header className="mb-6 overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div className="bg-primary/10 px-6 py-3 text-sm font-medium text-primary sm:px-8">
          <span aria-hidden="true">✦</span> A calm morning starts with a clear departure board.
        </div>
        <div className="p-6 sm:p-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
              {shop.name} · operations
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 max-w-xl text-muted">
              {upcoming.length === 0
                ? "Nothing on the books yet. Start with a trip, or add a diver so the next booking has a home."
                : `${upcoming.length} upcoming ${upcoming.length === 1 ? "trip" : "trips"} ready for the crew to work.`}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/shop/${shopSlug}/trips/new`}
              className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              Schedule a trip
            </Link>
            <Link
              href={`/shop/${shopSlug}/divers`}
              className="min-h-11 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-surface-sunken"
            >
              Add or find a diver
            </Link>
          </div>
        </div>
      </header>

      <section
        aria-label="Shop snapshot"
        className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ShopStat
          label="Upcoming trips"
          value={upcoming.length}
          detail={upcoming.length === 1 ? "One departure on the board" : "Departures on the board"}
          tone="primary"
        />
        <ShopStat
          label="Open seats"
          value={openSeats}
          detail={openSeats === 1 ? "One seat still available" : "Seats still available"}
          tone={openSeats > 0 ? "success" : "default"}
        />
        <ShopStat
          label="At capacity"
          value={fullTrips}
          detail={fullTrips === 1 ? "Trip needs no more bookings" : "Trips at capacity"}
        />
        <ShopStat
          label="Follow-ups"
          value={deliveryIssues.length}
          detail={
            deliveryIssues.length === 0 ? "No delivery issues" : "Email deliveries need attention"
          }
          tone={deliveryIssues.length > 0 ? "warning" : "success"}
        />
      </section>

      {nextManifest ? (
        <section
          aria-labelledby="next-boat-heading"
          className="mb-10 rounded-3xl border border-primary/30 bg-primary/5 p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
                Next boat
              </p>
              <h2 id="next-boat-heading" className="mt-2 text-xl font-semibold tracking-tight">
                {nextManifest.trip.title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {formatShortDate(nextManifest.trip.startsAt, "en-US", shop.timezone)} ·{" "}
                {formatTimeRange(
                  nextManifest.trip.startsAt,
                  nextManifest.trip.endsAt,
                  "en-US",
                  shop.timezone,
                )}
              </p>
            </div>
            <Link
              href={`/shop/${shopSlug}/trips/${nextManifest.trip.id}/manifest`}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              Open boat manifest{" "}
              <span aria-hidden="true" className="ml-2">
                →
              </span>
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Ready", nextManifest.summary.ready, "text-success"],
              ["Blocked", nextManifest.summary.blocked, "text-danger"],
              ["Boarded", nextManifest.summary.boarded, "text-primary"],
              ["Awaiting", nextManifest.summary.awaiting, "text-foreground"],
            ].map(([label, value, tone]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-border bg-surface px-4 py-3"
              >
                <p className="text-xs font-bold tracking-wide text-muted uppercase">{label}</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
          {nextManifest.summary.blocked > 0 ? (
            <p className="mt-4 text-sm font-semibold text-danger">
              {nextManifest.summary.blocked}{" "}
              {nextManifest.summary.blocked === 1 ? "diver needs" : "divers need"} attention before
              boarding.
            </p>
          ) : nextManifest.summary.totalDivers > 0 ? (
            <p className="mt-4 text-sm font-semibold text-success">
              Everyone currently has a clear readiness result. Finish roll call on the boat.
            </p>
          ) : (
            <p className="mt-4 text-sm font-medium text-muted">
              No divers are booked yet. The manifest will fill in as reservations arrive.
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="workspaces-heading" className="mb-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="workspaces-heading" className="text-lg font-semibold">
              Workspaces
            </h2>
            <p className="mt-1 text-sm text-muted">
              Follow the work from the person to the boat to the books.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href={`/shop/${shopSlug}/divers`}
            className="group rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">People</p>
            <h3 className="mt-1 font-semibold group-hover:text-primary">Divers</h3>
            <p className="mt-1 text-sm text-muted">
              Cards, rental fit, bookings, and issued gear in one person record.
            </p>
          </Link>
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className="group rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">Plan</p>
            <h3 className="mt-1 font-semibold group-hover:text-primary">Schedule</h3>
            <p className="mt-1 text-sm text-muted">
              Build charters and courses, then open each roster from the calendar.
            </p>
          </Link>
          <Link
            href={`/shop/${shopSlug}/gear`}
            className="group rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">Prepare</p>
            <h3 className="mt-1 font-semibold group-hover:text-primary">Get the boat ready</h3>
            <p className="mt-1 text-sm text-muted">
              Resolve waivers, readiness blockers, gear requests, and packing work.
            </p>
          </Link>
          <Link
            href={`/shop/${shopSlug}/orders`}
            className="group rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">Business</p>
            <h3 className="mt-1 font-semibold group-hover:text-primary">Orders</h3>
            <p className="mt-1 text-sm text-muted">
              Invoice the right person from their trip context and track payment state from their
              Diver page.
            </p>
          </Link>
        </div>
      </section>

      {created ? <ShopNotice>“{created}” is on the board. 🤙</ShopNotice> : null}

      {reset ? (
        <ShopNotice tone="neutral">Demo data reset — fresh boat, clean slate. 🤿</ShopNotice>
      ) : null}

      {email ? (
        <ShopNotice tone={email === "sent" ? "success" : "danger"}>
          {email === "sent"
            ? "Confirmation email re-sent."
            : "That email still couldn’t be sent — check the address and email configuration."}
        </ShopNotice>
      ) : null}

      {deliveryIssues.length > 0 ? (
        <section
          aria-labelledby="delivery-issues-heading"
          className="mb-8 rounded-2xl border border-warning/30 bg-warning/10 p-5"
        >
          <h2 id="delivery-issues-heading" className="font-semibold">
            Email delivery needs attention
          </h2>
          <p className="mt-1 text-sm text-muted">
            {deliveryIssues.length === 1
              ? "One email needs a follow-up."
              : `${deliveryIssues.length} emails need a follow-up.`}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {deliveryIssues.map(({ delivery, booking, person, trip, attempts }) => (
              <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="font-medium">
                    {delivery.kind === "booking_confirmation"
                      ? "Booking confirmation"
                      : "Waiver link"}
                  </span>{" "}
                  for {person.fullName} on {trip.title}:{" "}
                  {delivery.status === "not_configured"
                    ? "email is not configured."
                    : "delivery was unsuccessful."}
                  {attempts > 1 ? <span className="text-muted"> ({attempts} attempts)</span> : null}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {delivery.kind === "booking_confirmation" ? (
                    <form action={retryConfirmationAction}>
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <button
                        type="submit"
                        className="min-h-11 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
                      >
                        Retry email
                      </button>
                    </form>
                  ) : null}
                  <Link
                    href={`/shop/${shopSlug}/trips/${trip.id}`}
                    className="min-h-11 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-primary transition-colors duration-200 hover:bg-surface-sunken"
                  >
                    Open trip
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="upcoming-heading">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 id="upcoming-heading" className="text-lg font-semibold">
              Next departures
            </h2>
            <p className="mt-1 text-sm text-muted">
              Open a trip to work through its roster and readiness.
            </p>
          </div>
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className="text-sm font-medium text-primary hover:underline"
          >
            View schedule →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
            <div
              className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-2xl"
              aria-hidden="true"
            >
              ⚓
            </div>
            <h2 className="mt-4 font-medium">No trips on the books</h2>
            <p className="mt-1 text-sm text-muted">
              Schedule your first charter and it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/shop/${shopSlug}/trips/${trip.id}`}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <h2 className="font-medium group-hover:text-primary">{trip.title}</h2>
                    {trip.course ? (
                      <p className="text-sm font-medium text-primary">
                        Course session · {trip.course.title}
                      </p>
                    ) : null}
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
      </section>
    </main>
  );
}
