"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { BookingPartyFields } from "@/components/BookingPartyFields";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { capacityLabel } from "@/lib/trips";
import { type BookingFormState, bookSpot, joinWaitlist, type TripRef } from "../actions";
import type { Trip } from "./types";

function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="text-xs font-normal text-danger">
      {message}
    </span>
  );
}

export function WaitlistConfirmation({
  firstName,
  shopSlug,
  embed,
}: {
  firstName: string;
  shopSlug: string;
  embed?: boolean;
}) {
  const t = useTranslations();
  return (
    // A wait-list join isn't the earned win the rationed accent is for
    // (design/principles.md #3) — a seat isn't held yet, so this stays the
    // calm everyday treatment; only a real confirmed booking gets the coral.
    <section className="rise-in mt-10 rounded-lg border border-border bg-surface p-6">
      <h2 className="text-xl font-semibold text-balance">
        {t("booking.waitlistConfirmedHeading", { name: firstName })}
      </h2>
      <p className="mt-2 text-muted">{t("booking.waitlistConfirmedBody")}</p>
      <Link
        href={`/shop/${shopSlug}/schedule${embed ? "?embed=1" : ""}`}
        className="mt-3 inline-flex min-h-11 items-center text-base font-medium text-primary hover:underline"
      >
        {t("common.backToSchedule")}
      </Link>
    </section>
  );
}

export function TripSailedNotice({ shopSlug, embed }: { shopSlug: string; embed?: boolean }) {
  const t = useTranslations("booking");
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-medium">{t("sailedHeading")}</h2>
      <p className="mt-1 text-sm text-muted">
        <Link
          href={`/shop/${shopSlug}/schedule${embed ? "?embed=1" : ""}`}
          className="font-medium text-primary hover:underline"
        >
          {t("sailedCheckSchedule")}
        </Link>{" "}
        {t("sailedForNext")}
      </p>
    </section>
  );
}

/**
 * A cancelled trip's own soft landing (task 13) — before this it fell through
 * to the same `notFound()` as a typo'd URL, a bare 404 with no way back for a
 * diver who followed a saved or shared link. `contactEmail` is optional: a
 * shop that hasn't set one just gets the schedule link.
 */
export function CancelledTripNotice({
  shopSlug,
  embed,
  contactEmail,
}: {
  shopSlug: string;
  embed?: boolean;
  contactEmail?: string | null;
}) {
  const t = useTranslations("booking");
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-medium">{t("cancelledHeading")}</h2>
      <p className="mt-1 text-sm text-muted">
        <Link
          href={`/shop/${shopSlug}/schedule${embed ? "?embed=1" : ""}`}
          className="font-medium text-primary hover:underline"
        >
          {t("sailedCheckSchedule")}
        </Link>{" "}
        {t("cancelledBody")}
      </p>
      {contactEmail ? (
        <p className="mt-2 text-sm text-muted">
          {t("cancelledContact", { contact: contactEmail })}
        </p>
      ) : null}
    </section>
  );
}

export function ConditionsHoldSection() {
  const t = useTranslations("booking");
  return (
    <section className="mt-10 rounded-lg border border-warning/40 bg-warning/10 p-6">
      <h2 className="font-semibold">{t("holdHeading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("holdBody")}</p>
    </section>
  );
}

export function TripFullSection({
  shopSlug,
  trip,
  tripRef,
  remaining,
  errorMessage,
  contactEmail,
  contactPhone,
}: {
  shopSlug: string;
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
}) {
  const t = useTranslations("booking");
  return (
    // Same `#book` anchor as `BookSpotSection` below — the sticky mobile CTA
    // (schedule/[id]/page.tsx) targets it whether or not the trip is full
    // (task 12), so a full boat still lands the diver on a real next step
    // (the wait list) instead of nowhere.
    <section id="book" className="mt-10 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-medium">{t("fullHeading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {t("fullBody", { capacity: trip.capacity })}{" "}
        <Link
          href={`/shop/${shopSlug}/schedule${tripRef.embed ? "?embed=1" : ""}`}
          className="font-medium text-primary hover:underline"
        >
          {t("findAnotherTrip")}
        </Link>{" "}
        {t("reefNotGoingAnywhere")}
      </p>
      <ErrorNotice message={errorMessage} />
      <form
        action={joinWaitlist.bind(null, tripRef)}
        className="mt-6 flex flex-col gap-4 border-t border-border pt-6"
      >
        <div>
          <h3 className="font-semibold">{t("waitlistHeading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("waitlistBody")}</p>
        </div>
        <BookingPartyFields
          maxPartySize={remaining}
          leadPhone
          contactEmail={contactEmail}
          contactPhone={contactPhone}
        />
        <div>
          <SubmitButton
            pendingLabel={t("waitlistJoining")}
            className={buttonClass({ className: "px-6 py-3 text-base disabled:opacity-70" })}
          >
            {t("waitlistHeading")}
          </SubmitButton>
        </div>
      </form>
      <p className="mt-4 text-sm text-muted">
        {t("wantAnyTripAlertsInstead")}{" "}
        <Link
          href={`/shop/${shopSlug}/schedule${tripRef.embed ? "?embed=1" : ""}#last-minute-list`}
          className="font-medium text-primary hover:underline"
        >
          {t("joinLastMinuteDealAlerts")}
        </Link>
      </p>
    </section>
  );
}

const INITIAL_BOOKING_STATE: BookingFormState = {};

export function BookSpotSection({
  trip,
  tripRef,
  remaining,
  errorMessage,
  payAtBooking,
  perDiverPriceCents,
  locale,
  contactEmail,
  contactPhone,
}: {
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
  payAtBooking: boolean;
  perDiverPriceCents: number | null;
  locale: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
}) {
  const t = useTranslations("booking");
  const tRoot = useTranslations();
  const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const [state, formAction] = useActionState(bookSpot.bind(null, tripRef), INITIAL_BOOKING_STATE);
  // Task 18: "3 divers × $120 = $360" above the submit button once the party
  // grows past one — `BookingPartyFields` owns the size selector, so it
  // reports changes back up rather than this section duplicating that state.
  const [partySize, setPartySize] = useState(1);
  const bookLabel = payAtBooking
    ? remaining === 1
      ? t("bookAndPayLastSpot")
      : t("bookAndPay")
    : remaining === 1
      ? t("bookLastSpot")
      : t("bookSpots");
  const capacityLabelValue = capacityLabel(trip);
  const capacityText =
    capacityLabelValue.kind === "full"
      ? tRoot("fallback.full")
      : tRoot("fallback.spotsLeft", { count: capacityLabelValue.remaining });
  return (
    <section id="book" className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("heading")}</h2>
        <span className="text-sm font-medium text-primary tabular-nums">{capacityText}</span>
      </div>
      {payAtBooking && perDiverPriceCents ? (
        <p className="mt-1 text-sm text-muted">
          {t("paidSecurely", { price: usd.format(perDiverPriceCents / 100) })}
        </p>
      ) : null}
      <ErrorNotice message={state.error ?? errorMessage} />
      {trip.course?.isIntroCourse ? (
        <p className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted">
          <strong className="text-foreground">{t("giftTitle")}</strong> {t("giftBody")}
        </p>
      ) : null}
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <BookingPartyFields
          maxPartySize={remaining}
          leadPhone
          fieldErrors={state.fieldErrors}
          remember={!tripRef.embed}
          onSizeChange={setPartySize}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
        />
        {partySize > 1 && perDiverPriceCents ? (
          <p className="-mt-2 text-sm font-medium tabular-nums">
            {t("partyTotal", {
              count: partySize,
              price: usd.format(perDiverPriceCents / 100),
              total: usd.format((partySize * perDiverPriceCents) / 100),
            })}
          </p>
        ) : null}
        {/* Self-declared only (task 23) — this checkbox is not persisted and
            does not gate the booking transaction; full enforcement (a birth
            date on file, a hard refusal) is deliberately out of scope, see
            docs/product/human-decisions.md H-08/H-22. */}
        {trip.course?.minimumAge ? (
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" name="ageAttestation" required className="mt-0.5 size-4" />
            {t("ageAttestation", { age: trip.course.minimumAge })}
          </label>
        ) : null}
        <FieldGrid columns={1}>
          <Field label={t("preferenceLabel")} hint={t("preferenceHint")}>
            <textarea
              name="groupPreference"
              rows={2}
              maxLength={300}
              placeholder={t("preferencePlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        {payAtBooking ? (
          <FieldGrid columns={1} className="max-w-64">
            {/* A shop-wide code and a trip-scoped last-minute deal are typed
                into the same box — the diver has no idea which kind they were
                handed, and the server resolves both (docs ADR
                20260729-shop-promo-codes). */}
            <Field
              label={t("promoLabel")}
              hint={t("promoHint")}
              description={
                <FieldError id="promoCode-error" message={state.fieldErrors?.promoCode} />
              }
            >
              <input
                name="promoCode"
                autoComplete="off"
                maxLength={40}
                aria-invalid={state.fieldErrors?.promoCode ? "true" : undefined}
                aria-describedby={state.fieldErrors?.promoCode ? "promoCode-error" : undefined}
                className={`${controlClass} uppercase`}
              />
            </Field>
          </FieldGrid>
        ) : null}
        <div className="mt-1">
          <SubmitButton
            pendingLabel={payAtBooking ? t("headingToPayment") : t("booking")}
            className={buttonClass({ className: "px-6 py-3 text-base disabled:opacity-70" })}
          >
            {bookLabel}
          </SubmitButton>
          {/* The scariest hop on hotel wifi (task 19) — said once, up front,
              rather than only after the tap commits the diver to it. */}
          {payAtBooking ? <p className="mt-2 text-xs text-muted">{t("stripeHint")}</p> : null}
        </div>
        <p className="text-sm text-muted">{t("noAccountNeeded")}</p>
      </form>
    </section>
  );
}
