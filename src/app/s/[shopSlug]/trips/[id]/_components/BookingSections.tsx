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
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import type { PassThroughFee } from "@/lib/pass-through-fee";
import { publicSchedulePath } from "@/lib/public-routes";
import { hasAnyRentalPricing, type RentalPricing } from "@/lib/rentals";
import { capacityLabel } from "@/lib/trips";
import { type BookingFormState, bookSpot, joinWaitlist, type TripRef } from "../actions";
import { BookingGearFields } from "./BookingGearFields";
import { MoneyBlock } from "./MoneyBlock";
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
    <section className="rise-in mt-10 rounded-panel bg-surface-sunken p-6">
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
    <section id="book" className="mt-10 scroll-mt-4 rounded-panel bg-surface-sunken p-5 sm:p-6">
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

/**
 * **The form, terminal** — the last thing on the page, with the money resolved
 * once directly above the button (ADR 20260827-the-divers-thread, decision 2).
 *
 * Three things this composition is not allowed to drift back into:
 *
 * - **No nested boxes.** Party, gear and the rest are hairline-separated steps
 *   of one sheet. The card is the only edge; every bordered fieldset inside it
 *   read as a second frame around a third.
 * - **One figure.** `MoneyBlock` owns every amount this card states, and it
 *   states exactly one at or above `text-lg`. The card description that quoted
 *   the price under the heading is gone with the party total, the running
 *   checkout total, the fee line and the tax line — the hero says the price
 *   once, this block says the total once, and nothing in between says it again.
 * - **Nothing under the button but fine print.** The free-cancellation sentence
 *   (`TripTerms`) is the only copy below the action. The requirement note that
 *   used to sit *inside* this card in a sunken box is the page's now, above the
 *   form, where a diver reads it before starting to type.
 */
export function BookSpotSection({
  trip,
  tripRef,
  remaining,
  errorMessage,
  payAtBooking,
  perDiverPriceCents,
  currency,
  locale,
  contactEmail,
  contactPhone,
  rentalItems,
  rentalPricing,
  passThroughFee,
  taxEnabled,
  courseFeeCents,
  eLearningFeeCents,
  depositCents,
  balanceDueAt,
  timeZone,
  terms,
}: {
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
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
   * Whether Stripe Tax is on for this shop (ADR
   * 20260826-stripe-tax-is-opt-in-and-provider-owned). When it is, the figure
   * above is not what the card is charged: tax is exclusive, computed by Stripe
   * from an address this page does not have, and added on top. The one number a
   * booking page must not surprise anyone with is the one they commit to, so
   * the page says so rather than quoting a total it cannot compute (issue
   * #1019).
   */
  taxEnabled?: boolean;
  /**
   * A course session's two priced halves, per diver (`courseCharges`), resolved
   * by the page so the arithmetic stays server-side. Null on an ordinary
   * charter, and each hides its own line in `MoneyBlock`.
   */
  courseFeeCents?: number | null;
  eLearningFeeCents?: number | null;
  /**
   * The per-diver deposit this checkout takes (`checkoutCharge`), or null when
   * it charges the full fare. Read only when the diver is paying now.
   */
  depositCents?: number | null;
  /** When the remainder is owed — the departure's own day. */
  balanceDueAt?: Date | null;
  /** The shop's zone. A date rendered without one reads in the host's (UTC). */
  timeZone: string;
  /**
   * The one sentence of fine print under the button (`TripTerms`) — the free
   * cancellation window, server-rendered by the page. Null when the shop
   * states none. Every *figure* moved into `MoneyBlock`.
   */
  terms?: React.ReactNode;
}) {
  const t = useTranslations("booking");
  const tRoot = useTranslations();
  const money = (cents: number) => formatMoneyCents(cents, currency, locale);
  const [state, formAction] = useActionState(bookSpot.bind(null, tripRef), INITIAL_BOOKING_STATE);
  // `BookingPartyFields` owns the party-count control, so it reports changes
  // back up rather than this section duplicating that state — `MoneyBlock`
  // multiplies the fare by it.
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
    >
      {/* No `description` any more. It quoted the per-diver price under the
          heading — the second of the five places this card said the money, on a
          page whose hero had already said it at figure scale. */}
      <form action={formAction} className="flex flex-col gap-4">
        <BookingPartyFields
          maxPartySize={remaining}
          leadPhone
          fieldErrors={state.fieldErrors}
          remember={!tripRef.embed}
          onSizeChange={setPartySize}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
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
        {/* **The certification question is not asked here at all.** It was,
            per diver, until 2026-08-27 (product owner) — and asking a
            stranger for a rung before they have paid bought a sale-time
            warning and a self-declared claim written onto a named person's
            record from an anonymous form. `/ready/<token>` asks the same
            question of the diver whose booking it is, after the sale, with
            the agency and number beside it. The departure's own requirement
            is stated by the page above this form, which is the half a
            deciding diver needs. */}
        {/* Self-declared only (task 23) — this checkbox is not persisted and
            does not gate the booking transaction; full enforcement (a birth
            date on file, a hard refusal) is deliberately out of scope, see
            docs/product/human-decisions.md H-08/H-22. */}
        {trip.course?.minimumAge ? (
          <label className="flex min-h-11 items-start gap-2 border-t border-border pt-4 text-sm">
            <input type="checkbox" name="ageAttestation" required className="mt-0.5 size-4" />
            {t("ageAttestation", { age: trip.course.minimumAge })}
          </label>
        ) : null}
        <div className="flex flex-col gap-4 border-t border-border pt-4">
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
        </div>
        {/* The money, said once, immediately above the button that commits to
            it. Five `text-sm` siblings scattered through this form did this job
            before — see `MoneyBlock`. */}
        {perDiverPriceCents === null ? null : (
          <MoneyBlock
            className="border-t border-border pt-4"
            fareCents={perDiverPriceCents}
            partySize={partySize}
            gearCents={gearTotalCents}
            courseFeeCents={courseFeeCents ?? null}
            eLearningFeeCents={eLearningFeeCents ?? null}
            passThroughFeeLine={
              passThroughFee
                ? t("passThroughFee", {
                    name: passThroughFee.name,
                    price: money(passThroughFee.amountCents),
                  })
                : null
            }
            passThroughTotalCents={passThroughTotalCents}
            // Only where there *is* a checkout for Stripe to add tax at. On a
            // book-now-pay-later seat the sentence used to render anyway, under
            // a total labelled "Due at the shop" — a page telling a diver about
            // a checkout step that does not exist for them (issue #1019's line,
            // read in the wrong branch).
            taxLine={taxEnabled && payAtBooking ? "checkout" : "none"}
            dueNow={payAtBooking ? "checkout" : "at_shop"}
            depositCents={depositCents ?? null}
            balanceDueAt={balanceDueAt ?? null}
            currency={currency}
            locale={locale}
            timeZone={timeZone}
          />
        )}
        <div className="mt-1">
          <SubmitButton
            pendingLabel={payAtBooking ? t("headingToPayment") : t("booking")}
            className={buttonClass({ className: "px-6 py-3 text-base disabled:opacity-70" })}
          >
            {bookLabel}
          </SubmitButton>
          {/* The scariest hop on hotel wifi (task 19) — said once, up front,
              rather than only after the tap commits the diver to it. Only when
              there is a checkout to hop to. */}
          {payAtBooking ? <p className="mt-2 text-xs text-muted">{t("stripeHint")}</p> : null}
          {/* The one sentence still ahead of a diver who has decided. */}
          {terms}
          {/* The refusal used to render above the whole form — above the party
              fields, the gear fields, and the promo box. On a phone that is
              several thumb-scrolls from the button the diver just tapped, so a
              refused booking read as a button that did nothing. */}
          <ErrorNotice message={state.error ?? errorMessage} />
        </div>
      </form>
    </SectionCard>
  );
}
