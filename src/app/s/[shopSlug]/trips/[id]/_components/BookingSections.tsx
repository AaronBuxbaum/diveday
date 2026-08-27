"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useState } from "react";
import { BookingPartyFields } from "@/components/BookingPartyFields";
import { DiveDeclarationFields } from "@/components/DiveDeclarationFields";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { DECLARABLE_CERTIFICATION_LEVELS, NO_CERTIFICATION_ANSWER } from "@/lib/dive-declaration";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import type { PassThroughFee } from "@/lib/pass-through-fee";
import { publicSchedulePath } from "@/lib/public-routes";
import { type CertificationLevel, certificationRank } from "@/lib/readiness";
import { hasAnyRentalPricing, type RentalPricing } from "@/lib/rentals";
import { capacityLabel } from "@/lib/trips";
import { type BookingFormState, bookSpot, joinWaitlist, type TripRef } from "../actions";
import { BookingGearFields } from "./BookingGearFields";
import type { Trip } from "./types";

/**
 * Why the booking was refused, rendered inside the form beside the button that
 * was pressed — never above the form, where a party of three's worth of fields
 * puts it off screen. The staff-side equivalent is `FormStatus`
 * (src/components/ui/form.tsx); this one keeps the diver-facing `ShopNotice`
 * box, which is the weight a refused *purchase* deserves.
 */
function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <ShopNotice tone="danger" role="alert" className="mt-4">
      {message}
    </ShopNotice>
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
    // (design/principles.md #3) — a seat isn't held yet, so this sits on the
    // same sunken material as the full-boat state it came from: a place in
    // line, not a seat on the boat. Only a real confirmed booking gets coral.
    <section className="rise-in mt-10 rounded-2xl bg-surface-sunken p-6">
      <h2 className="text-lg font-semibold text-balance">
        {t("booking.waitlistConfirmedHeading", { name: firstName })}
      </h2>
      <p className="mt-2 text-muted">{t("booking.waitlistConfirmedBody")}</p>
      <Link
        href={`${publicSchedulePath(shopSlug)}${embed ? "?embed=1" : ""}`}
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
    // Type only, no card: a sailed trip has nothing to sell and nothing to do
    // here, so it must not wear the same box as a live booking form — a state
    // with no action gets no frame (design/principles.md #10, remove until it
    // breaks). The one link is the whole surface.
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-muted">{t("sailedHeading")}</h2>
      <p className="mt-1 text-muted">
        <Link
          href={`${publicSchedulePath(shopSlug)}${embed ? "?embed=1" : ""}`}
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
    // This is very nearly the whole page a saved link lands on, so it speaks
    // in the masthead's own type rather than from inside a small gray box —
    // and like the sailed state, a departure with nothing to do gets no frame.
    <section className="mt-10">
      <h2 className="text-2xl font-semibold tracking-tight text-balance">
        {t("cancelledHeading")}
      </h2>
      <p className="mt-2 text-muted">
        <Link
          href={`${publicSchedulePath(shopSlug)}${embed ? "?embed=1" : ""}`}
          className="font-medium text-primary hover:underline"
        >
          {t("sailedCheckSchedule")}
        </Link>{" "}
        {t("cancelledBody")}
      </p>
      {contactEmail ? (
        <p className="mt-2 text-muted">{t("cancelledContact", { contact: contactEmail })}</p>
      ) : null}
    </section>
  );
}

export function ConditionsHoldSection() {
  const t = useTranslations("booking");
  return (
    // Quiet type, not a second warning box: the conditions-hold banner under
    // the masthead already carries the warning tone, and `holdBody` points
    // back up at it. Two amber cards saying adjacent things was the page
    // warning the diver twice about one fact (design/principles.md #9).
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t("holdHeading")}</h2>
      <p className="mt-1 text-muted">{t("holdBody")}</p>
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
  terms,
}: {
  shopSlug: string;
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /**
   * The same money fine print (`TripTerms`) the open form renders beside its
   * button. A wait-list join commits the diver to these terms the moment a
   * seat opens, so a full boat states them too — before this they rendered
   * only on the open state, and a deposit-taking trip's cancellation window
   * vanished the moment it sold out.
   */
  terms?: React.ReactNode;
}) {
  const t = useTranslations("booking");
  const tTrip = useTranslations("trip");
  return (
    // Same `#book` anchor as `BookSpotSection` below — the sticky mobile CTA
    // (trips/[id]/page.tsx) targets it whether or not the trip is full
    // (task 12), so a full boat still lands the diver on a real next step
    // (the wait list) instead of nowhere.
    //
    // Sunken material, no border, on purpose: the open state is the page's one
    // raised card, and a boat with no seats must not wear the same surface —
    // full *feels* like less is on offer before a word is read. The wait list
    // is still a real form, so it keeps the full form treatment inside.
    //
    // The heading is `text-lg`, the one size `SectionCard` renders, because
    // this section and the open booking form are alternates in the same slot:
    // when the open form moved onto the shared card, the four states that
    // replace it were briefly a size louder — "This trip is full" shouting
    // over "Grab a spot".
    <section id="book" className="mt-10 scroll-mt-4 rounded-2xl bg-surface-sunken p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{t("fullHeading")}</h2>
      <p className="mt-1 text-muted">
        <Link
          href={`${publicSchedulePath(shopSlug)}${tripRef.embed ? "?embed=1" : ""}`}
          className="font-medium text-primary hover:underline"
        >
          {t("findAnotherTrip")}
        </Link>{" "}
        {t("reefNotGoingAnywhere")}
      </p>
      <form
        action={joinWaitlist.bind(null, tripRef)}
        className="mt-6 flex flex-col gap-4 border-t border-border pt-6"
      >
        <div>
          <h3 className="font-semibold">{t("waitlistHeading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("waitlistBody")}</p>
          {/* The open form states the age with its attestation checkbox; the
              wait list has no such checkbox, so a course's minimum age is said
              here in plain words — a parent deciding whether to queue their
              kid needs the answer before a seat opens, not after (task 23). */}
          {trip.course?.minimumAge ? (
            <p className="mt-1 text-sm text-muted">
              {tTrip("minimumAge", { age: trip.course.minimumAge })}
            </p>
          ) : null}
        </div>
        <BookingPartyFields
          maxPartySize={remaining}
          leadPhone
          contactEmail={contactEmail}
          contactPhone={contactPhone}
        />
        {/* The same optional question the shop-wide deal list asks, in the same
            words, so a staffer working either list is reading one claim rather
            than two (FU-20260813). It describes the person joining — the lead
            of the party — and never gates the join.

            This list also asks for the agency and number (`DiveDeclarationFields`
            carries both); the shop-wide deal list asks the level alone. That is
            deliberate rather than drift: a wait list is for a *departure*, so
            there is something for a staffer to pre-check the number against
            before that date. A broad interest signal has no date to check it
            for. */}
        <DiveDeclarationFields showNitrox={false} />
        <div>
          <SubmitButton
            pendingLabel={t("waitlistJoining")}
            className={buttonClass({ className: "px-6 py-3 text-base disabled:opacity-70" })}
          >
            {t("waitlistHeading")}
          </SubmitButton>
          {/* Same placement as the open form: the fine print sits under the
              button it qualifies. */}
          {terms}
          <ErrorNotice message={errorMessage} />
        </div>
      </form>
      <p className="mt-4 text-sm text-muted">
        {t("wantAnyTripAlertsInstead")}{" "}
        <Link
          href={`${publicSchedulePath(shopSlug)}${tripRef.embed ? "?embed=1" : ""}#last-minute-list`}
          className="font-medium text-primary hover:underline"
        >
          {t("joinLastMinuteDealAlerts")}
        </Link>
      </p>
    </section>
  );
}

const INITIAL_BOOKING_STATE: BookingFormState = {};

/** Stable per-slot keys for the gear fieldsets — mirrors `BookingPartyFields`'s `diverSlots`. */
const GEAR_SLOTS = ["gear-one", "gear-two", "gear-three", "gear-four", "gear-five", "gear-six"];

export function BookSpotSection({
  trip,
  tripRef,
  remaining,
  errorMessage,
  requirementHeading,
  requirementNote,
  minimumCertificationLevel,
  payAtBooking,
  perDiverPriceCents,
  currency,
  locale,
  contactEmail,
  contactPhone,
  rentalItems,
  rentalPricing,
  passThroughFee,
  terms,
}: {
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
  /**
   * What the trip asks of anybody, already composed and translated by the page
   * (`tripRequirementList`) — a property of the *trip*, never of the reader, so
   * it is safe on an anonymous page. Undefined when the trip demands nothing.
   *
   * It is stated here, above the form, because it used to be stated nowhere
   * until after the seat was bought: a diver who could not clear the gate read
   * "4 spots left", paid, and met the requirement for the first time at the
   * dock (DOM-M6).
   */
  requirementHeading?: string;
  requirementNote?: string;
  /**
   * The level this departure asks for, as a bare ladder code, so each diver's
   * own answer can be measured against it as they pick it. Separate from
   * `requirementNote` above, which is a finished sentence about the trip and
   * says nothing about the person reading it. Undefined when no level is
   * demanded — a specialty-only or nitrox-only gate is not something a level
   * select can warn about.
   */
  minimumCertificationLevel?: CertificationLevel;
  payAtBooking: boolean;
  perDiverPriceCents: number | null;
  /** The shop's currency — this is a list price, so it follows the shop, not a payment row. */
  currency: ShopCurrency;
  locale: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** The shop's rental catalog and price list — a gear step only renders when both offer something priced. */
  rentalItems: string[];
  rentalPricing: RentalPricing;
  /** A shop-configured third-party charge, shown separately from shop fare. */
  passThroughFee?: PassThroughFee | null;
  /**
   * The money fine print (`TripTerms`), server-rendered by the page and
   * placed here beside the button it qualifies — deposit split, cancellation
   * window, course-fee breakdown. Null when the trip has no terms to state.
   */
  terms?: React.ReactNode;
}) {
  const t = useTranslations("booking");
  const tRoot = useTranslations();
  const money = (cents: number) => formatMoneyCents(cents, currency, locale);
  const [state, formAction] = useActionState(bookSpot.bind(null, tripRef), INITIAL_BOOKING_STATE);
  // Task 18: "3 divers × $120 = $360" above the submit button once the party
  // grows past one — `BookingPartyFields` owns the size selector, so it
  // reports changes back up rather than this section duplicating that state.
  const [partySize, setPartySize] = useState(1);
  // Per-diver gear subtotal, reported up by each `BookingGearFields` slot
  // (docs ADR 20260801-checkout-upsells-rental-gear) — summed into the running
  // total below so "3 divers × $120" becomes accurate once gear is added.
  const [gearSubtotals, setGearSubtotals] = useState<Record<number, number>>({});
  const onGearSubtotalChange = useCallback((index: number, cents: number) => {
    setGearSubtotals((current) =>
      current[index] === cents ? current : { ...current, [index]: cents },
    );
  }, []);
  /**
   * **A warning, not a stop.** A diver who says "Open Water" on an Advanced
   * charter is told so at the moment they say it — and then buys the seat
   * anyway (product owner, 2026-08-20, closing
   * FU-20260820-the-sale-gate-bites-only-the-honest). The refusal it replaced
   * only ever caught the diver who answered *honestly and short*: naming a
   * higher rung, or leaving the field at "Rather not say", both walked
   * straight through. So the gate punished honesty, and handed the refused
   * diver the answer to give on the next attempt.
   *
   * Nothing here is a safety decision. Boarding is still `calculateReadiness`
   * over a card a staffer has sighted, and that is unchanged.
   *
   * **"I'm not certified yet" gets its own sentence, not silence.** It is the
   * one answer certain to be below the gate, and the commonest answer at a shop
   * selling Discover Scuba — a person who has just told an ordinary charter
   * they hold no card at all will be blocked at readiness and turned away at
   * the dock. Course sessions never reach here (the page passes no level for
   * one), so this is always a charter. Pointing them at the shop is the only
   * thing that helps; a rung they do not hold is not.
   */
  const belowRequirementFor = useCallback(
    (level: string) => {
      if (!minimumCertificationLevel) return null;
      if (!level) return null;
      if (level === NO_CERTIFICATION_ANSWER) return tRoot("booking.certNoneOnGatedTrip");
      if (!DECLARABLE_CERTIFICATION_LEVELS.includes(level as CertificationLevel)) return null;
      if (
        certificationRank(level as CertificationLevel) >=
        certificationRank(minimumCertificationLevel)
      ) {
        return null;
      }
      return tRoot("booking.certBelowRequirement", {
        required: tRoot(DIVER_CERTIFICATION_LEVEL_KEYS[minimumCertificationLevel]),
      });
    },
    [minimumCertificationLevel, tRoot],
  );
  const showGearFields = payAtBooking && hasAnyRentalPricing(rentalPricing);
  const passThroughTotalCents = (passThroughFee?.amountCents ?? 0) * partySize;
  // Shrinking the party leaves a stale subtotal behind for the dropped slot
  // (BookingGearFields unmounts, but its last report stays in state) — sum
  // only the indexes still in play.
  const activeGearIndexes = new Set(Array.from({ length: partySize }, (_, index) => String(index)));
  const gearTotalCents = showGearFields
    ? Object.entries(gearSubtotals)
        .filter(([index]) => activeGearIndexes.has(index))
        .reduce((sum, [, cents]) => sum + cents, 0)
    : 0;
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
    // The page's one raised card: the booking form is what this page exists
    // for, so it is the only composition that gets border + shadow elevation.
    // Every other state and every supporting section sits flatter than this.
    <SectionCard
      id="book"
      // `padding="lg"` is `p-5 sm:p-6` — the exact spelling this card already
      // carried by hand, so the one raised card on the page keeps its geometry
      // and only its heading steps to the shared size.
      padding="lg"
      className="mt-10 scroll-mt-4"
      title={t("heading")}
      actions={
        <span className="text-sm font-medium text-primary tabular-nums">{capacityText}</span>
      }
      description={
        payAtBooking && perDiverPriceCents !== null && perDiverPriceCents > 0
          ? t("paidSecurely", { price: money(perDiverPriceCents) })
          : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {requirementNote ? (
          <div className="rounded-lg border border-border bg-surface-sunken p-3 text-sm">
            {requirementHeading ? (
              <h3 className="font-semibold text-foreground">{requirementHeading}</h3>
            ) : null}
            <p className="mt-1 text-muted">{requirementNote}</p>
          </div>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4">
          <BookingPartyFields
            maxPartySize={remaining}
            leadPhone
            fieldErrors={state.fieldErrors}
            remember={!tripRef.embed}
            onSizeChange={setPartySize}
            contactEmail={contactEmail}
            contactPhone={contactPhone}
            askCertification
            belowRequirementFor={belowRequirementFor}
          />
          {showGearFields
            ? Array.from({ length: partySize }, (_, index) => (
                <BookingGearFields
                  key={GEAR_SLOTS[index]}
                  index={index}
                  showDiverLabel={partySize > 1}
                  rentalItems={rentalItems}
                  course={trip.course}
                  pricing={rentalPricing}
                  plannedDives={trip.plannedDives}
                  currency={currency}
                  onSubtotalChange={onGearSubtotalChange}
                />
              ))
            : null}
          {/* The certification question used to sit here, once, describing the
              lead booker only — so a party of four answered it for one seat and
              the other three ran the gate with nothing. It now lives inside
              each diver's own fieldset in `BookingPartyFields`, which is where
              a person's own answer belongs. */}
          {perDiverPriceCents !== null && (gearTotalCents > 0 || passThroughTotalCents > 0) ? (
            <p className="-mt-2 text-sm font-medium tabular-nums">
              {t("totalDueAtCheckout", {
                total: money(
                  partySize * perDiverPriceCents + gearTotalCents + passThroughTotalCents,
                ),
              })}
            </p>
          ) : partySize > 1 && perDiverPriceCents !== null ? (
            <p className="-mt-2 text-sm font-medium tabular-nums">
              {t("partyTotal", {
                count: partySize,
                price: money(perDiverPriceCents),
                total: money(partySize * perDiverPriceCents + passThroughTotalCents),
              })}
            </p>
          ) : null}
          {passThroughFee ? (
            <p className="-mt-2 text-sm text-muted tabular-nums">
              {t("passThroughFee", {
                name: passThroughFee.name,
                price: money(passThroughFee.amountCents),
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
            {/* The money fine print, right under the button it qualifies —
              deposit split, cancellation window, course-fee breakdown. It
              lived in the masthead before, a whole page away from the tap it
              was written for. */}
            {terms}
            {/* The refusal used to render above the whole form — above the party
              fields, the gear fields, and the promo box. On a phone that is
              several thumb-scrolls from the button the diver just tapped, so a
              refused booking read as a button that did nothing. */}
            <ErrorNotice message={state.error ?? errorMessage} />
          </div>
          <p className="text-sm text-muted">{t("noAccountNeeded")}</p>
        </form>
      </div>
    </SectionCard>
  );
}
