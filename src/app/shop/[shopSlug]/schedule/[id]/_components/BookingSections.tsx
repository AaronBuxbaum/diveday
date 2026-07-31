"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { BookingPartyFields } from "@/components/BookingPartyFields";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { capacityLabel } from "@/lib/trips";
import { type BookingFormState, bookSpot, joinWaitlist, type TripRef } from "../actions";
import type { Trip } from "./types";

function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <ShopNotice tone="danger" role="alert" className="mt-4">
      {message}
    </ShopNotice>
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
}: {
  shopSlug: string;
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
}) {
  const t = useTranslations("booking");
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-6">
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
        <BookingPartyFields maxPartySize={remaining} leadPhone />
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
}: {
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
  payAtBooking: boolean;
  perDiverPriceCents: number | null;
  locale: string;
}) {
  const t = useTranslations("booking");
  const tRoot = useTranslations();
  const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const [state, formAction] = useActionState(bookSpot.bind(null, tripRef), INITIAL_BOOKING_STATE);
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
        />
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
            <Field label={t("promoLabel")} hint={t("promoHint")}>
              <input
                name="promoCode"
                autoComplete="off"
                maxLength={40}
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
        </div>
        <p className="text-sm text-muted">{t("noAccountNeeded")}</p>
      </form>
    </section>
  );
}
