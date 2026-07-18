import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import {
  getRentalGearProfile,
  getRentalGearRequest,
  saveRentalGearRequest,
} from "@/db/gear-requests";
import { sendAndRecordNotification } from "@/db/notifications";
import { getBookingForTrip, getShopBySlug, getTripWithBooked } from "@/db/queries";
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

const rentalRequestSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  tank: z.string().optional(),
  diveComputer: z.string().optional(),
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  bootSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
  weightPreference: z.string().trim().max(80),
  note: z.string().trim().max(300),
});

const RENTAL_GEAR_OPTIONS = [
  { name: "bcd", label: "BCD" },
  { name: "regulator", label: "Regulator" },
  { name: "wetsuit", label: "Wetsuit" },
  { name: "maskFins", label: "Mask & fins" },
  { name: "weights", label: "Weights" },
  { name: "tank", label: "Tank" },
  { name: "diveComputer", label: "Dive computer" },
] as const;

const ERRORS: Record<string, string> = {
  invalid: "Check your name and email and give it another go.",
  full: "Someone grabbed the last spot just before you — the boat's full.",
  already: "You're already on this trip's list — no need to book twice.",
  unavailable: "This trip isn't taking bookings anymore.",
  "course-unavailable":
    "This course still needs an assigned instructor before it can take bookings.",
  "course-prerequisite":
    "This course needs a verified certification on file. Call the shop and they’ll help get your card checked.",
  gear: "We couldn’t save that gear request. Please check the details and try again.",
};

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ booking?: string; error?: string; gear?: string }>;
}) {
  await connection();
  const { shopSlug, id: tripId } = await params;
  const { booking: bookingId, error, gear } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();

  // The confirmation renders only from a real booking row — never from a
  // URL claim (design principle 6: trustworthy by inspection).
  const confirmed = bookingId ? await getBookingForTrip(db, tripId, bookingId) : null;
  const readiness = confirmed ? await getBookingReadiness(db, shop.id, confirmed.booking.id) : null;
  const rentalRequest = confirmed
    ? await getRentalGearRequest(db, shop.id, confirmed.booking.id)
    : null;
  const rentalProfile = confirmed
    ? await getRentalGearProfile(db, shop.id, confirmed.person.id)
    : null;

  const inPast = trip.startsAt <= new Date();
  const full = isFull(trip);
  const remaining = spotsRemaining(trip);
  const errorMessage = error ? ERRORS[error] : undefined;

  async function bookSpot(formData: FormData) {
    "use server";
    const parsed = bookSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
    const dbi = await getDb();
    const shopNow = await getShopBySlug(dbi, shopSlug);
    if (!shopNow) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
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
            : outcome.reason === "course_unstaffed"
              ? "course-unavailable"
              : outcome.reason === "course_prerequisite"
                ? "course-prerequisite"
                : "unavailable";
      redirect(`/shop/${shopSlug}/schedule/${tripId}?error=${code}`);
    }
    const [confirmedBooking, tripNow] = await Promise.all([
      getBookingForTrip(dbi, tripId, outcome.bookingId),
      getTripWithBooked(dbi, shopNow.id, tripId),
    ]);
    if (confirmedBooking?.person.email && tripNow) {
      try {
        const delivery = await sendAndRecordNotification(dbi, {
          kind: "booking_confirmation",
          bookingId: outcome.bookingId,
          shopId: shopNow.id,
          to: confirmedBooking.person.email,
          diverName: confirmedBooking.person.fullName,
          shopName: shopNow.name,
          tripTitle: tripNow.title,
          startsAt: tripNow.startsAt,
          endsAt: tripNow.endsAt,
          timezone: shopNow.timezone,
        });
        if (delivery.status === "failed") {
          console.error("Booking confirmation notification failed", {
            bookingId: outcome.bookingId,
          });
        }
      } catch {
        // Email must never turn a completed, capacity-safe booking into an error page.
        console.error("Booking confirmation notification could not be prepared", {
          bookingId: outcome.bookingId,
        });
      }
    }
    redirect(`/shop/${shopSlug}/schedule/${tripId}?booking=${outcome.bookingId}`);
  }

  const inputClass =
    "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <FlashParams params={["error"]} />
      <Link
        href={`/shop/${shopSlug}/schedule`}
        className="text-sm font-medium text-primary hover:underline"
      >
        ← All trips
      </Link>

      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{trip.title}</h1>
        <p className="mt-2 text-lg text-muted">
          {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
          {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
        </p>
        {trip.course ? (
          <p className="mt-2 text-sm font-medium text-primary">
            Course session · {trip.course.title}
          </p>
        ) : null}
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
          <section className="mt-5 rounded-lg border border-border bg-surface/70 p-4 text-left">
            <h3 className="font-medium">Rental gear</h3>
            <p className="mt-1 text-sm text-muted">
              Tell the crew what you’d like to rent. We start with a typical set; they’ll confirm
              fit and weighting with you at the dock.
            </p>
            {gear === "saved" ? (
              <p
                role="status"
                className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
              >
                Your gear request is with the crew.
              </p>
            ) : null}
            <form
              action={async (formData) => {
                "use server";
                const parsed = rentalRequestSchema.safeParse(Object.fromEntries(formData));
                if (!parsed.success)
                  redirect(
                    `/shop/${shopSlug}/schedule/${tripId}?booking=${confirmed.booking.id}&error=gear`,
                  );
                const saved = await saveRentalGearRequest(await getDb(), {
                  shopId: shop.id,
                  bookingId: confirmed.booking.id,
                  bcd: parsed.data.bcd === "on",
                  regulator: parsed.data.regulator === "on",
                  wetsuit: parsed.data.wetsuit === "on",
                  maskFins: parsed.data.maskFins === "on",
                  weights: parsed.data.weights === "on",
                  tank: parsed.data.tank === "on",
                  diveComputer: parsed.data.diveComputer === "on",
                  bcdSize: parsed.data.bcdSize,
                  wetsuitSize: parsed.data.wetsuitSize,
                  bootSize: parsed.data.bootSize,
                  finSize: parsed.data.finSize,
                  weightPreference: parsed.data.weightPreference,
                  note: parsed.data.note,
                });
                redirect(
                  `/shop/${shopSlug}/schedule/${tripId}?booking=${confirmed.booking.id}&${saved ? "gear=saved" : "error=gear"}`,
                );
              }}
              className="mt-4 flex flex-col gap-4"
            >
              <fieldset>
                <legend className="text-sm font-medium">What should we plan to have ready?</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {RENTAL_GEAR_OPTIONS.map(({ name, label }) => {
                    const requested = rentalRequest?.[name];
                    const defaultChecked = requested ?? name !== "diveComputer";
                    return (
                      <label
                        key={name}
                        className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                      >
                        <input
                          name={name}
                          type="checkbox"
                          defaultChecked={defaultChecked}
                          className="size-4 accent-primary"
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  BCD size
                  <select
                    name="bcdSize"
                    defaultValue={rentalRequest?.bcdSize ?? rentalProfile?.bcdSize ?? ""}
                    className={inputClass}
                  >
                    <option value="">Not sure — help me fit it</option>
                    {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Wetsuit size
                  <select
                    name="wetsuitSize"
                    defaultValue={rentalRequest?.wetsuitSize ?? rentalProfile?.wetsuitSize ?? ""}
                    className={inputClass}
                  >
                    <option value="">Not sure — help me fit it</option>
                    {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  <span>
                    Boot size <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <input
                    name="bootSize"
                    maxLength={20}
                    defaultValue={rentalRequest?.bootSize ?? rentalProfile?.bootSize ?? ""}
                    placeholder="US 9 / EU 42"
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  <span>
                    Fin size <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <input
                    name="finSize"
                    maxLength={20}
                    defaultValue={rentalRequest?.finSize ?? rentalProfile?.finSize ?? ""}
                    placeholder="M/L"
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm font-medium">
                <span>
                  Usual weight setup <span className="font-normal text-muted">(optional)</span>
                </span>
                <input
                  name="weightPreference"
                  maxLength={80}
                  defaultValue={
                    rentalRequest?.weightPreference ?? rentalProfile?.weightPreference ?? ""
                  }
                  placeholder="e.g. 16 lb with a 3 mm suit"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                <span>
                  Anything else the crew should know?{" "}
                  <span className="font-normal text-muted">(optional)</span>
                </span>
                <textarea
                  name="note"
                  rows={2}
                  maxLength={300}
                  defaultValue={rentalRequest?.note ?? ""}
                  className={inputClass}
                />
              </label>
              <div>
                <SubmitButton
                  pendingLabel="Saving gear…"
                  className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
                >
                  Save gear request
                </SubmitButton>
              </div>
            </form>
          </section>
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className="mt-3 inline-block py-2 text-base font-medium text-primary hover:underline"
          >
            Back to the schedule
          </Link>
        </section>
      ) : inPast ? (
        <section className="mt-10 rounded-lg border border-border bg-surface p-6">
          <h2 className="font-medium">This one's already sailed</h2>
          <p className="mt-1 text-sm text-muted">
            <Link
              href={`/shop/${shopSlug}/schedule`}
              className="font-medium text-primary hover:underline"
            >
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
            <Link
              href={`/shop/${shopSlug}/schedule`}
              className="font-medium text-primary hover:underline"
            >
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
                <span>
                  Phone <span className="font-normal text-muted">(optional)</span>
                </span>
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
