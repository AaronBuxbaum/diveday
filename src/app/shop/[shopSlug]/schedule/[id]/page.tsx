import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { BookingPartyFields } from "@/components/BookingPartyFields";
import { DiveBriefingCard } from "@/components/DiveBriefingCard";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { createBookingParty } from "@/db/bookings";
import { getDb } from "@/db/client";
import { listDiveSiteCreatures, listPublishedDiveSiteMoments } from "@/db/dive-sites";
import {
  getRentalGearProfile,
  getRentalGearRequest,
  saveRentalGearRequest,
} from "@/db/gear-requests";
import { sendAndRecordNotification } from "@/db/notifications";
import {
  getBookingForTrip,
  getShopBySlug,
  getTripWithBooked,
  getWaitlistEntryForTrip,
  listTripDives,
} from "@/db/queries";
import { getBookingReadiness } from "@/db/readiness";
import { joinTripWaitlist } from "@/db/waitlist";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { dockDayTimeline } from "@/lib/diver-planning";
import { formatShortDate, formatTimeRange, formatTimeRangeTz } from "@/lib/format";
import {
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "@/lib/marine-forecast";
import { revalidateAndRedirect } from "@/lib/navigation";
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

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Check your name and email and give it another go.",
  full: "Someone grabbed the last spot just before you — the boat's full.",
  available: "Good news — a spot just opened. Book it before it goes.",
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
  searchParams: Promise<{ booking?: string; waitlist?: string; error?: string; gear?: string }>;
}) {
  await connection();
  const { shopSlug, id: tripId } = await params;
  const { booking: bookingId, waitlist: waitlistId, error, gear } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const session = await auth();
  if (session?.user?.shopId === shop.id && isStaff(session.user.roles)) {
    redirect(`/shop/${shopSlug}/trips/${tripId}`);
  }
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const tripDives = await listTripDives(db, shop.id, tripId);
  const crewPrediction = hasCrewPrediction(trip);
  const forecastPoint =
    trip.diveSite &&
    trip.diveSite.forecastLatitude !== null &&
    trip.diveSite.forecastLongitude !== null
      ? { latitude: trip.diveSite.forecastLatitude, longitude: trip.diveSite.forecastLongitude }
      : null;
  const automatedForecast =
    !crewPrediction && forecastPoint && shouldShowAutomatedForecast(trip.startsAt)
      ? await fetchAutomatedMarineForecast(forecastPoint, trip.startsAt)
      : null;

  // The confirmation renders only from a real booking row — never from a
  // URL claim (design principle 6: trustworthy by inspection).
  const confirmed = bookingId ? await getBookingForTrip(db, tripId, bookingId) : null;
  const waitlistConfirmation = waitlistId
    ? await getWaitlistEntryForTrip(db, tripId, waitlistId)
    : null;
  const diveBriefings = await Promise.all(
    tripDives.map(async ({ dive, diveSite }) => {
      const [creatures, moments] = diveSite
        ? await Promise.all([
            listDiveSiteCreatures(db, shop.id, diveSite.id),
            listPublishedDiveSiteMoments(db, shop.id, diveSite.id),
          ])
        : [[], []];
      return { dive, diveSite, creatures, moments };
    }),
  );
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
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  async function bookSpot(formData: FormData) {
    "use server";
    const partySize = z.coerce.number().int().min(1).max(6).safeParse(formData.get("partySize"));
    if (!partySize.success) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
    const party = Array.from({ length: partySize.data }, (_, index) =>
      bookSchema.safeParse({
        fullName: formData.get(`fullName-${index}`),
        email: formData.get(`email-${index}`),
      }),
    );
    const validParty = party.flatMap((entry) => (entry.success ? [entry.data] : []));
    if (validParty.length !== partySize.data)
      redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
    const dbi = await getDb();
    const shopNow = await getShopBySlug(dbi, shopSlug);
    if (!shopNow) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
    const outcome = await createBookingParty(
      dbi,
      validParty.map((entry) => ({
        shopId: shopNow.id,
        tripId,
        fullName: entry.fullName,
        email: entry.email,
      })),
    );
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
    const primaryBookingId = outcome.bookings[0]?.bookingId;
    if (!primaryBookingId) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
    const [confirmedBooking, tripNow] = await Promise.all([
      getBookingForTrip(dbi, tripId, primaryBookingId),
      getTripWithBooked(dbi, shopNow.id, tripId),
    ]);
    if (confirmedBooking?.person.email && tripNow) {
      try {
        const delivery = await sendAndRecordNotification(dbi, {
          kind: "booking_confirmation",
          bookingId: primaryBookingId,
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
            bookingId: primaryBookingId,
          });
        }
      } catch {
        // Email must never turn a completed, capacity-safe booking into an error page.
        console.error("Booking confirmation notification could not be prepared", {
          bookingId: primaryBookingId,
        });
      }
    }
    revalidateAndRedirect(
      `/shop/${shopSlug}/schedule/${tripId}`,
      `/shop/${shopSlug}/schedule/${tripId}?booking=${primaryBookingId}`,
    );
  }

  async function joinWaitlist(formData: FormData) {
    "use server";
    const parsed = bookSchema.safeParse({
      fullName: formData.get("fullName-0"),
      email: formData.get("email-0"),
    });
    if (!parsed.success) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid`);
    const dbi = await getDb();
    const shopNow = await getShopBySlug(dbi, shopSlug);
    if (!shopNow) redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable`);
    const outcome = await joinTripWaitlist(dbi, {
      shopId: shopNow.id,
      tripId,
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone || undefined,
    });
    if (outcome.ok || outcome.reason === "already_waitlisted") {
      revalidateAndRedirect(
        `/shop/${shopSlug}/schedule/${tripId}`,
        `/shop/${shopSlug}/schedule/${tripId}?waitlist=${outcome.entryId}`,
      );
    }
    const code =
      outcome.reason === "trip_available"
        ? "available"
        : outcome.reason === "already_booked"
          ? "already"
          : "unavailable";
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=${code}`);
  }

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
        {trip.priceCents !== null ? (
          <p className="mt-3 text-lg font-semibold tabular-nums">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              trip.priceCents / 100,
            )}{" "}
            <span className="text-sm font-normal text-muted">per diver</span>
          </p>
        ) : null}
      </header>
      {!confirmed && !inPast && !full ? (
        <a
          href="#book"
          className="fixed right-4 bottom-4 z-20 inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-3 font-medium text-primary-foreground shadow-lg sm:hidden"
        >
          Book · {remaining} left
        </a>
      ) : null}

      {diveBriefings.length > 0 ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium tracking-widest text-primary uppercase">
                Dive briefings
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                {trip.plannedDives === 2
                  ? "Your two-tank plan"
                  : `Your ${trip.plannedDives}-dive plan`}
              </h2>
            </div>
            {diveBriefings.length > 1 ? (
              <p className="text-sm font-medium text-muted sm:hidden">
                Swipe to explore each dive →
              </p>
            ) : null}
          </div>
          {/* Dives stack in one column on larger screens: a two-tank day often
              pairs one richly-briefed site with a sparse second tank, and a
              multi-column grid would strand a tall card beside a near-empty one.
              Full-width cards size to their own content, so there is no blank box. */}
          <div className="-mx-6 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-3 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-1 sm:overflow-visible sm:px-0">
            {diveBriefings.map(({ dive, diveSite, creatures, moments }) => (
              <DiveBriefingCard
                key={dive.id}
                diveNumber={dive.diveNumber}
                title={dive.title}
                description={dive.description}
                site={diveSite}
                creatures={creatures}
                moments={moments}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            Conditions and timing apply to the whole boat day. Sites can change, and the crew makes
            the final call at the dock.
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Pack with confidence</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {shop.packingList.map((item) => (
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

      {crewPrediction || automatedForecast ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            {crewPrediction ? "Crew prediction" : "Automated marine outlook"}
          </p>
          {crewPrediction && trip.conditionsSummary ? (
            <p className="mt-3 text-muted">{trip.conditionsSummary}</p>
          ) : null}
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            {(crewPrediction ? trip.waterTemperatureC : automatedForecast?.waterTemperatureC) !==
            null ? (
              <div className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-sm text-muted">Water temperature</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {crewPrediction ? trip.waterTemperatureC : automatedForecast?.waterTemperatureC}°C
                </dd>
              </div>
            ) : null}
            {crewPrediction && trip.visibilityMeters !== null ? (
              <div className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-sm text-muted">Visibility</dt>
                <dd className="mt-1 text-lg font-semibold">{trip.visibilityMeters} m</dd>
              </div>
            ) : null}
            {(crewPrediction ? trip.surfaceConditions : automatedForecast?.surfaceConditions) ? (
              <div className="rounded-lg bg-surface-sunken p-3">
                <dt className="text-sm text-muted">Surface</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {crewPrediction ? trip.surfaceConditions : automatedForecast?.surfaceConditions}
                </dd>
              </div>
            ) : null}
          </dl>
          {crewPrediction ? (
            <p className="mt-4 text-xs text-muted">
              Forecast supplied by the crew; conditions can change. The final call happens at the
              dock.
              {trip.conditionsUpdatedAt
                ? ` Updated ${trip.conditionsUpdatedAt.toLocaleString("en-US", { timeZone: shop.timezone, timeZoneName: "short" })}.`
                : " Update time unavailable."}
            </p>
          ) : automatedForecast ? (
            <div className="mt-4">
              <p className="text-base text-muted">
                Planning outlook from Open-Meteo — the crew confirms conditions and makes the final
                call at the dock.
              </p>
              <p className="mt-2 text-xs text-muted">
                Underwater visibility comes from the crew.{" "}
                <time dateTime={automatedForecast.validAt.toISOString()}>
                  For {formatShortDate(automatedForecast.validAt, "en-US", shop.timezone)} ·{" "}
                  {automatedForecast.validAt.toLocaleTimeString("en-US", {
                    timeZone: shop.timezone,
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </time>
              </p>
            </div>
          ) : null}
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
                  <li key={blocker.message}>• {blocker.message}</li>
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
                revalidateAndRedirect(
                  `/shop/${shopSlug}/schedule/${tripId}`,
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
              <FieldGrid columns={2}>
                <Field label="BCD size">
                  <select
                    name="bcdSize"
                    defaultValue={rentalRequest?.bcdSize ?? rentalProfile?.bcdSize ?? ""}
                    className={controlClass}
                  >
                    <option value="">Not sure — help me fit it</option>
                    {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Wetsuit size">
                  <select
                    name="wetsuitSize"
                    defaultValue={rentalRequest?.wetsuitSize ?? rentalProfile?.wetsuitSize ?? ""}
                    className={controlClass}
                  >
                    <option value="">Not sure — help me fit it</option>
                    {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Boot size" hint="(optional)">
                  <input
                    name="bootSize"
                    maxLength={20}
                    defaultValue={rentalRequest?.bootSize ?? rentalProfile?.bootSize ?? ""}
                    placeholder="US 9 / EU 42"
                    className={controlClass}
                  />
                </Field>
                <Field label="Buddy or group notes" hint="(optional)">
                  <textarea
                    name="buddyPreference"
                    rows={2}
                    maxLength={300}
                    placeholder="I’m travelling with Maya; we’d love a relaxed photo pace."
                    className={controlClass}
                  />
                </Field>
                <Field label="Fin size" hint="(optional)">
                  <input
                    name="finSize"
                    maxLength={20}
                    defaultValue={rentalRequest?.finSize ?? rentalProfile?.finSize ?? ""}
                    placeholder="M/L"
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid columns={1}>
                <Field label="Usual weight setup" hint="(optional)">
                  <input
                    name="weightPreference"
                    maxLength={80}
                    defaultValue={
                      rentalRequest?.weightPreference ?? rentalProfile?.weightPreference ?? ""
                    }
                    placeholder="e.g. 16 lb with a 3 mm suit"
                    className={controlClass}
                  />
                </Field>
                <Field label="Anything else the crew should know?" hint="(optional)">
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={300}
                    defaultValue={rentalRequest?.note ?? ""}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <div>
                <SubmitButton
                  pendingLabel="Saving gear…"
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                    className: "px-4 text-foreground",
                  })}
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
      ) : waitlistConfirmation ? (
        <section className="rise-in mt-10 rounded-lg border border-accent/40 bg-accent/10 p-6">
          <h2 className="text-xl font-semibold text-balance">
            You&apos;re on the wait list, {waitlistConfirmation.person.fullName.split(" ")[0]}.
          </h2>
          <p className="mt-2 text-muted">
            A spot is not held yet. The shop can see your place in line and will contact you if one
            opens up.
          </p>
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
          {errorMessage ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          ) : null}
          <form
            action={joinWaitlist}
            className="mt-6 flex flex-col gap-4 border-t border-border pt-6"
          >
            <div>
              <h3 className="font-semibold">Join the wait list</h3>
              <p className="mt-1 text-sm text-muted">
                If a spot opens, the shop will have your details ready.
              </p>
            </div>
            <BookingPartyFields maxPartySize={remaining} />
            <div>
              <SubmitButton
                pendingLabel="Joining…"
                className={buttonClass({
                  className: "px-6 py-3 text-base disabled:opacity-70",
                })}
              >
                Join the wait list
              </SubmitButton>
            </div>
          </form>
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
            <BookingPartyFields maxPartySize={remaining} />
            <div className="mt-1">
              <SubmitButton
                pendingLabel="Booking…"
                className={buttonClass({
                  className: "px-6 py-3 text-base disabled:opacity-70",
                })}
              >
                Book {remaining === 1 ? "the last spot" : "these spots"}
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
