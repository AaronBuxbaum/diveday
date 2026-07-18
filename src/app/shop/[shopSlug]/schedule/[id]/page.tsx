import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { DiveSiteFieldGuide } from "@/components/DiveSiteFieldGuide";
import { DiveSiteLandmarks } from "@/components/DiveSiteLandmarks";
import { DiveSiteMap } from "@/components/DiveSiteMap";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { listDiveSiteCreatures, listPublishedDiveSiteMoments } from "@/db/dive-sites";
import {
  getRentalGearProfile,
  getRentalGearRequest,
  saveRentalGearRequest,
} from "@/db/gear-requests";
import { sendAndRecordNotification } from "@/db/notifications";
import { getBookingForTrip, getShopBySlug, getTripWithBooked } from "@/db/queries";
import { getBookingReadiness } from "@/db/readiness";
import { buildDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { getSeedDiveSiteMap } from "@/lib/dive-site-map";
import { dockDayTimeline, packingChecklist } from "@/lib/diver-planning";
import { formatShortDate, formatTimeRange, formatTimeRangeTz } from "@/lib/format";
import { capacityLabel, isFull, spotsRemaining } from "@/lib/trips";

export const metadata: Metadata = {
  title: "Trip — Scuba",
};

const bookSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
  buddyPreference: z.string().trim().max(300).optional(),
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
  const [creatures, moments] = trip.diveSite
    ? await Promise.all([
        listDiveSiteCreatures(db, shop.id, trip.diveSite.id),
        listPublishedDiveSiteMoments(db, shop.id, trip.diveSite.id),
      ])
    : [[], []];
  const landmarks = trip.diveSite
    ? buildDiveSiteLandmarks(trip.diveSite.name, trip.diveSite.landmarks)
    : [];
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
      buddyPreference: parsed.data.buddyPreference || undefined,
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
      {!confirmed && !inPast && !full ? (
        <a
          href="#book"
          className="fixed right-4 bottom-4 z-20 min-h-11 rounded-full bg-primary px-5 py-3 font-medium text-primary-foreground shadow-lg sm:hidden"
        >
          Book · {remaining} left
        </a>
      ) : null}

      {trip.diveSite ? (
        <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface">
          {getSeedDiveSiteMap(trip.diveSite.name) ? (
            <DiveSiteMap siteName={trip.diveSite.name} />
          ) : trip.diveSite.satelliteImageUrl ? (
            // biome-ignore lint/performance/noImgElement: staff-provided media supports arbitrary approved hosts without a global image allowlist.
            <img
              src={trip.diveSite.satelliteImageUrl}
              alt={`Satellite view of ${trip.diveSite.name}`}
              className="h-64 w-full object-cover"
            />
          ) : null}
          <div className="p-5 sm:p-6">
            <p className="text-sm font-medium tracking-widest text-primary uppercase">
              Your dive site
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{trip.diveSite.name}</h2>
            {trip.diveSite.locationName ? (
              <p className="mt-1 text-sm text-muted">{trip.diveSite.locationName}</p>
            ) : null}
            {trip.diveSite.description ? (
              <p className="mt-4 text-muted">{trip.diveSite.description}</p>
            ) : null}
            {trip.diveSite.difficulty || trip.diveSite.depthRange || trip.diveSite.currentNote ? (
              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-y border-border py-5 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                    Experience
                  </dt>
                  <dd className="mt-1 font-semibold capitalize">
                    {trip.diveSite.difficulty ?? "Crew-led"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                    Depth
                  </dt>
                  <dd className="mt-1 font-semibold">{trip.diveSite.depthRange ?? "Varies"}</dd>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                    Water movement
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {trip.diveSite.currentNote ?? "The crew confirms it at the dock."}
                  </dd>
                </div>
              </dl>
            ) : null}
            {trip.diveSite.routeImageUrl ? (
              <figure className="mt-5 overflow-hidden rounded-lg border border-border">
                {/* biome-ignore lint/performance/noImgElement: staff-provided media supports arbitrary approved hosts without a global image allowlist. */}
                <img
                  src={trip.diveSite.routeImageUrl}
                  alt={`Planned route for ${trip.diveSite.name}`}
                  className="max-h-80 w-full object-cover"
                />
                <figcaption className="px-3 py-2 text-sm text-muted">
                  Planned route — the crew will brief the final plan on board.
                </figcaption>
              </figure>
            ) : null}
            {trip.diveSite.divePlan ? (
              <section className="mt-8 grid gap-2 sm:grid-cols-[10rem_1fr] sm:gap-6">
                <h3 className="font-semibold">How the dive unfolds</h3>
                <p className="leading-relaxed text-muted">{trip.diveSite.divePlan}</p>
              </section>
            ) : null}
            <DiveSiteLandmarks landmarks={landmarks} />
            <DiveSiteFieldGuide
              creatures={creatures}
              summary={trip.diveSite.marineLifeDescription}
              highlights={trip.diveSite.marineLife}
            />
            {moments.length ? (
              <div className="mt-6 rounded-lg bg-accent/10 p-4">
                <h3 className="font-semibold">A recent diver moment</h3>
                <p className="mt-1 text-sm text-muted">{moments[0]?.caption}</p>
              </div>
            ) : null}
            {creatures.length === 0 && trip.diveSite.imageUrls.length > 0 ? (
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {trip.diveSite.imageUrls.map((url, index) => (
                  // biome-ignore lint/performance/noImgElement: staff-provided media supports arbitrary approved hosts without a global image allowlist.
                  <img
                    key={url}
                    src={url}
                    alt={`${trip.diveSite?.name} scene ${index + 1}`}
                    className="aspect-square rounded-lg object-cover"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Pack with confidence</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {packingChecklist(trip.waterTemperatureC, trip.surfaceConditions).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3 className="mt-5 font-semibold">Your dock-day rhythm</h3>
        <ol className="mt-2 space-y-1 text-sm text-muted">
          {dockDayTimeline(trip.startsAt).map((step) => (
            <li key={step.label}>
              {step.label} ·{" "}
              {step.at.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: shop.timezone,
              })}
            </li>
          ))}
        </ol>
      </section>

      {trip.conditionsSummary ||
      trip.waterTemperatureC !== null ||
      trip.visibilityMeters !== null ||
      trip.surfaceConditions ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            Predicted conditions
          </p>
          {trip.conditionsSummary ? (
            <p className="mt-3 text-muted">{trip.conditionsSummary}</p>
          ) : null}
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            {trip.waterTemperatureC !== null ? (
              <div className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-sm text-muted">Water temperature</dt>
                <dd className="mt-1 text-lg font-semibold">{trip.waterTemperatureC}°C</dd>
              </div>
            ) : null}
            {trip.visibilityMeters !== null ? (
              <div className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-sm text-muted">Visibility</dt>
                <dd className="mt-1 text-lg font-semibold">{trip.visibilityMeters} m</dd>
              </div>
            ) : null}
            {trip.surfaceConditions ? (
              <div className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-sm text-muted">Surface</dt>
                <dd className="mt-1 text-lg font-semibold">{trip.surfaceConditions}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-4 text-xs text-muted">
            Forecast supplied by the crew; conditions can change. The final call happens at the
            dock.
            {trip.conditionsUpdatedAt
              ? ` Updated ${trip.conditionsUpdatedAt.toLocaleString("en-US", { timeZone: shop.timezone, timeZoneName: "short" })}.`
              : " Update time unavailable."}
          </p>
        </section>
      ) : null}

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
                  Buddy or group notes <span className="font-normal text-muted">(optional)</span>
                  <textarea
                    name="buddyPreference"
                    rows={2}
                    maxLength={300}
                    placeholder="I’m travelling with Maya; we’d love a relaxed photo pace."
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
        <section id="book" className="mt-10">
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
