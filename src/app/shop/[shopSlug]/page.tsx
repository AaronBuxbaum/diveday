import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
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
  const firstName = session.user.name?.split(" ")[0] ?? "there";

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["created", "reset", "email"]} />
      <header className="mb-10">
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-muted">
            {upcoming.length === 0
              ? "Nothing on the books yet."
              : `${upcoming.length} upcoming ${upcoming.length === 1 ? "trip" : "trips"} on the schedule.`}
          </p>
        </div>
      </header>

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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Link
            href={`/shop/${shopSlug}/divers`}
            className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">People</p>
            <h3 className="mt-1 font-semibold">Divers</h3>
            <p className="mt-1 text-sm text-muted">
              Cards, rental fit, bookings, and issued gear in one person record.
            </p>
          </Link>
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">Plan</p>
            <h3 className="mt-1 font-semibold">Schedule</h3>
            <p className="mt-1 text-sm text-muted">
              Build charters and courses, then open each roster from the calendar.
            </p>
          </Link>
          <Link
            href={`/shop/${shopSlug}/gear`}
            className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">Prepare</p>
            <h3 className="mt-1 font-semibold">Get the boat ready</h3>
            <p className="mt-1 text-sm text-muted">
              Resolve waivers, readiness blockers, gear requests, and packing work.
            </p>
          </Link>
          <Link
            href={`/shop/${shopSlug}/orders`}
            className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/50 hover:bg-surface-sunken"
          >
            <p className="text-sm font-medium text-primary">Business</p>
            <h3 className="mt-1 font-semibold">Orders & payments</h3>
            <p className="mt-1 text-sm text-muted">
              Invoice the right person from their trip context and track payment state.
            </p>
          </Link>
        </div>
      </section>

      {created ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          “{created}” is on the board. 🤙
        </p>
      ) : null}

      {reset ? (
        <p
          role="status"
          className="mb-6 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm font-medium text-foreground"
        >
          Demo data reset — fresh boat, clean slate. 🤿
        </p>
      ) : null}

      {email ? (
        <p
          role="status"
          className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${email === "sent" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}
        >
          {email === "sent"
            ? "Confirmation email re-sent."
            : "That email still couldn’t be sent — check the address and email configuration."}
        </p>
      ) : null}

      {deliveryIssues.length > 0 ? (
        <section
          aria-labelledby="delivery-issues-heading"
          className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
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
                        className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
                      >
                        Retry email
                      </button>
                    </form>
                  ) : null}
                  <Link
                    href={`/shop/${shopSlug}/trips/${trip.id}`}
                    className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-primary transition-colors duration-200 hover:bg-surface-sunken"
                  >
                    Open trip
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
                href={`/shop/${shopSlug}/trips/${trip.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 className="font-medium">{trip.title}</h2>
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
    </main>
  );
}
