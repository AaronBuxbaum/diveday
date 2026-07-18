import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { getBookingForTrip, getDefaultShop, getTripWithBooked } from "@/db/queries";
import { getBookingReadiness } from "@/db/readiness";
import { formatShortDate, formatTimeRange, formatTimeRangeTz } from "@/lib/format";
import { capacityLabel, isFull, spotsRemaining } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Trip — Scuba",
};

const bookSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
});

const ERRORS: Record<string, string> = {
  invalid: "Check your name and email and give it another go.",
  full: "Someone grabbed the last spot just before you — the boat's full.",
  already: "You're already on this trip's list — no need to book twice.",
  unavailable: "This trip isn't taking bookings anymore.",
};

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ booking?: string; error?: string }>;
}) {
  await connection();
  const { id: tripId } = await params;
  const { booking: bookingId, error } = await searchParams;
  const db = await getDb();
  const shop = await getDefaultShop(db);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();

  // The confirmation renders only from a real booking row — never from a
  // URL claim (design principle 6: trustworthy by inspection).
  const confirmed = bookingId ? await getBookingForTrip(db, tripId, bookingId) : null;
  const readiness = confirmed ? await getBookingReadiness(db, shop.id, confirmed.booking.id) : null;

  const inPast = trip.startsAt <= new Date();
  const full = isFull(trip);
  const remaining = spotsRemaining(trip);
  const errorMessage = error ? ERRORS[error] : undefined;

  async function bookSpot(formData: FormData) {
    "use server";
    const parsed = bookSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/trips/${tripId}?error=invalid`);
    const dbi = await getDb();
    const shopNow = await getDefaultShop(dbi);
    if (!shopNow) redirect(`/trips/${tripId}?error=unavailable`);
    const outcome = await createBooking(dbi, {
      shopId: shopNow.id,
      tripId,
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone || undefined,
    });
    if (!outcome.ok) {
      const code =
        outcome.reason === "trip_full"
          ? "full"
          : outcome.reason === "already_booked"
            ? "already"
            : "unavailable";
      redirect(`/trips/${tripId}?error=${code}`);
    }
    redirect(`/trips/${tripId}?booking=${outcome.bookingId}`);
  }

  const inputClass =
    "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <FlashParams params={["error"]} />
      <Link href="/trips" className="text-sm font-medium text-primary hover:underline">
        ← All trips
      </Link>

      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{trip.title}</h1>
        <p className="mt-2 text-lg text-muted">
          {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
          {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
        </p>
        {trip.description ? <p className="mt-3 text-muted">{trip.description}</p> : null}
      </header>

      {confirmed ? (
        <section className="rise-in mt-10 rounded-lg border border-accent/40 bg-accent/10 p-6">
          <h2 className="text-xl font-semibold text-balance">
            You're on the boat, {confirmed.person.fullName.split(" ")[0]}! 🤿
          </h2>
          <p className="mt-2 text-muted">
            {formatShortDate(trip.startsAt, "en-US", shop.timezone)},{" "}
            {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)} — be at the dock
            30 minutes early and we'll take it from there.
          </p>
          {readiness?.status === "blocked" ? (
            <section className="mt-4 rounded-lg border border-border bg-surface/70 p-4 text-left">
              <h3 className="font-medium">Before your trip</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                {readiness.blockers.map((blocker) => (
                  <li key={blocker.code}>• {blocker.message}</li>
                ))}
              </ul>
            </section>
          ) : readiness?.status === "ready" ? (
            <p className="mt-4 text-sm font-medium text-success">
              Your pre-trip requirements are complete.
            </p>
          ) : null}
          <Link
            href="/trips"
            className="mt-3 inline-block py-2 text-base font-medium text-primary hover:underline"
          >
            Back to the schedule
          </Link>
        </section>
      ) : inPast ? (
        <section className="mt-10 rounded-lg border border-border bg-surface p-6">
          <h2 className="font-medium">This one's already sailed</h2>
          <p className="mt-1 text-sm text-muted">
            <Link href="/trips" className="font-medium text-primary hover:underline">
              Check the schedule
            </Link>{" "}
            for the next departure.
          </p>
        </section>
      ) : full ? (
        <section className="mt-10 rounded-lg border border-border bg-surface p-6">
          <h2 className="font-medium">This boat's full</h2>
          <p className="mt-1 text-sm text-muted">
            All {trip.capacity} spots are taken.{" "}
            <Link href="/trips" className="font-medium text-primary hover:underline">
              Find another trip
            </Link>{" "}
            — the reef isn't going anywhere.
          </p>
        </section>
      ) : (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Grab a spot</h2>
            <span className="text-sm font-medium text-primary tabular-nums">
              {capacityLabel(trip)}
            </span>
          </div>
          {errorMessage ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          ) : null}
          <form action={bookSpot} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-base font-medium">
              Name
              <input
                name="fullName"
                type="text"
                required
                maxLength={120}
                autoComplete="name"
                className={inputClass}
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-base font-medium">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={200}
                  autoComplete="email"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-base font-medium">
                Phone <span className="font-normal text-muted">(optional)</span>
                <input
                  name="phone"
                  type="tel"
                  maxLength={30}
                  autoComplete="tel"
                  className={inputClass}
                />
              </label>
            </div>
            <div className="mt-1">
              <SubmitButton
                pendingLabel="Booking…"
                className="min-h-11 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover disabled:opacity-70"
              >
                Book {remaining === 1 ? "the last spot" : "my spot"}
              </SubmitButton>
            </div>
            <p className="text-sm text-muted">
              No account needed. The shop will confirm your certification and gear at check-in.
            </p>
          </form>
        </section>
      )}
    </main>
  );
}
