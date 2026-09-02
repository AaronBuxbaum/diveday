import { ImageFileInput } from "@/components/ImageFileInput";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import {
  MAX_DECISION_HOURS,
  MAX_MINIMUM_BOOKINGS,
  MIN_DECISION_HOURS,
  MINIMUM_SEATS_DECISION_HOURS_DEFAULT,
} from "@/lib/minimum-seats";
import { currencyFractionDigits, maxPriceMajor, minorToMajor } from "@/lib/money";
import type { FormNotice } from "@/lib/staff-notices";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { toDateInputValue, toTimeInputValue, type WallTime } from "@/lib/zoned";
import { EditDisclosure } from "./EditDisclosure";
import type { DiveSiteList, Trip, TripDiveList } from "./types";

export function DetailsSection({
  action,
  status,
  trip,
  diveSiteList,
  tripDiveList,
  startWall,
  endWall,
  dayCount,
  locale,
  currency,
  warnNoPrice = true,
  embedded = false,
  boats,
  hasBoatDiving,
  hasShoreDiving,
  hasPoolDiving,
}: {
  action: (formData: FormData) => void;
  /** This form's own outcome, rendered beside its Save button rather than at the top of the page. */
  status?: FormNotice;
  trip: Trip;
  diveSiteList: DiveSiteList;
  tripDiveList: TripDiveList;
  startWall: WallTime;
  endWall: WallTime;
  /** How many consecutive days this departure meets on — its `trip_schedule_days` count. */
  dayCount: number;
  /** The shop's live fleet, for the hull select. Empty means no boat rows yet. */
  boats: { id: string; name: string }[];
  hasBoatDiving: boolean;
  hasShoreDiving: boolean;
  hasPoolDiving: boolean;
  locale: string;
  /** The shop's currency — what the numbers in these price boxes mean. */
  currency: string;
  /**
   * Whether a missing price is worth warning about — false on a cancelled
   * departure, whose booking page isn't selling anything.
   */
  warnNoPrice?: boolean;
  /** The Trip surface's About panel supplies the outer section chrome. */
  embedded?: boolean;
}) {
  const t = staffTranslator(locale);
  // Both price boxes follow the shop's currency: whole-number entry and a
  // symbol-only placeholder for a zero-decimal currency, where "$0.00" was
  // wrong twice over.
  const digits = currencyFractionDigits(currency);
  // Only the modes this shop actually runs, same rule the add panel applies —
  // a departure must not be switchable to a kind of diving the shop has said it
  // does not do. One option is no choice, so the select does not render.
  const MODE_KEYS = {
    boat: "boats.modeBoat",
    shore: "boats.modeShore",
    pool: "boats.modePool",
  } as const;
  const modeOptions = (["boat", "shore", "pool"] as const).filter((mode) =>
    mode === "boat" ? hasBoatDiving : mode === "shore" ? hasShoreDiving : hasPoolDiving,
  );
  const priceStep = digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
  const pricePlaceholder = formatMoneyCents(0, currency, locale);
  // The page header already carries date, times, capacity, and sites; this
  // summary states only what the header doesn't — the money facts and the
  // diver-facing description — so the section reads its current state without
  // opening the form (summary first, form on intent).
  const moneyFacts = [
    trip.priceCents === null
      ? null
      : t("trips.details.summaryPrice", {
          price: formatMoneyCents(trip.priceCents, currency, locale),
        }),
    trip.depositCents !== null && trip.depositCents > 0
      ? t("trips.details.summaryDeposit", {
          amount: formatMoneyCents(trip.depositCents, currency, locale),
        })
      : null,
    trip.cancellationWindowHours !== null
      ? t("trips.details.summaryCancellation", { hours: trip.cancellationWindowHours })
      : null,
  ].filter((part): part is string => Boolean(part));
  return (
    // Anchor target for the builder's "No price set" flag (task 150, UX
    // persona lens 17) — a builder-created trip publishes with no price and
    // no warning; this is where staff land to fix it.
    <SectionCard
      id="details"
      padding={embedded ? "none" : "lg"}
      title={t("trips.details.heading")}
      className={`${embedded ? "!rounded-none !border-0 !bg-transparent" : ""} scroll-mt-24`}
    >
      {trip.description ? <p className="max-w-2xl text-sm text-muted">{trip.description}</p> : null}
      {/* The missing price is a problem and wears warning ink alone; settled
          facts (deposit, cancellation window) stay muted rather than
          inheriting the alarm. */}
      {trip.priceCents === null && warnNoPrice ? (
        <p className="mt-1 text-sm font-medium text-warning-strong">
          {t("trips.details.summaryNoPrice")}
        </p>
      ) : null}
      {moneyFacts.length > 0 ? (
        <p className="mt-1 text-sm text-muted">{moneyFacts.join(" · ")}</p>
      ) : null}
      <EditDisclosure label={t("trips.details.edit")} open={Boolean(status)}>
        <form action={action} encType="multipart/form-data" className="mt-2 flex flex-col gap-5">
          <FieldGrid columns={1} className="max-w-2xl gap-y-5">
            <Field label={t("trips.details.titleLabel")}>
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                defaultValue={trip.title}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("trips.details.descriptionLabel")}
              hint={t("trips.details.optionalHint")}
            >
              <textarea
                name="description"
                rows={2}
                maxLength={500}
                defaultValue={trip.description ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          {/* Where this departure meets, when it isn't the shop's own front
              door — a marina three miles out, a shore dive's beach car park, a
              second dock (issue #704 slice 2). Both blank, the default and
              every trip until this shipped, means "the shop" everywhere this
              renders. Free text, not the shop's own address-search box: a
              meeting point is casual by nature, and geocoding one would guess
              wrong coordinates for exactly the kind of place this names. */}
          <FieldGrid columns={2} className="gap-x-5 gap-y-5">
            <Field
              label={t("trips.details.meetingPointLabelLabel")}
              hint={t("trips.details.optionalHint")}
            >
              <input
                name="meetingPointLabel"
                type="text"
                maxLength={120}
                defaultValue={trip.meetingPointLabel ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("trips.details.meetingPointAddressLabel")}
              hint={t("trips.details.optionalHint")}
            >
              <input
                name="meetingPointAddress"
                type="text"
                maxLength={200}
                defaultValue={trip.meetingPointAddress ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <fieldset className="rounded-inset bg-surface-sunken p-4 sm:p-5">
            <legend className="px-1 text-sm font-medium">
              {t("trips.details.arrivalGuidanceLegend")}
            </legend>
            <p className="text-sm text-muted">{t("trips.details.arrivalGuidanceDescription")}</p>
            <FieldGrid columns={2} className="mt-4 gap-x-5 gap-y-5">
              <Field
                label={t("trips.details.arrivalLandmarkLabel")}
                hint={t("trips.details.optionalHint")}
                description={t("trips.details.arrivalLandmarkDescription")}
              >
                <textarea
                  name="arrivalLandmark"
                  rows={2}
                  maxLength={300}
                  defaultValue={trip.arrivalLandmark ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("trips.details.arrivalLookForLabel")}
                hint={t("trips.details.optionalHint")}
                description={t("trips.details.arrivalLookForDescription")}
              >
                <textarea
                  name="arrivalLookFor"
                  rows={2}
                  maxLength={300}
                  defaultValue={trip.arrivalLookFor ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("trips.details.arrivalFirstInteractionLabel")}
                hint={t("trips.details.optionalHint")}
                description={t("trips.details.arrivalFirstInteractionDescription")}
              >
                <textarea
                  name="arrivalFirstInteraction"
                  rows={2}
                  maxLength={300}
                  defaultValue={trip.arrivalFirstInteraction ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("trips.details.arrivalParkingLabel")}
                hint={t("trips.details.optionalHint")}
                description={t("trips.details.arrivalParkingDescription")}
              >
                <textarea
                  name="arrivalParkingNote"
                  rows={2}
                  maxLength={300}
                  defaultValue={trip.arrivalParkingNote ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("trips.details.arrivalTransitLabel")}
                hint={t("trips.details.optionalHint")}
                description={t("trips.details.arrivalTransitDescription")}
              >
                <textarea
                  name="arrivalTransitNote"
                  rows={2}
                  maxLength={300}
                  defaultValue={trip.arrivalTransitNote ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("trips.details.arrivalPhotoLabel")}
                hint={t("trips.details.optionalHint")}
                description={t("trips.details.arrivalPhotoDescription")}
                htmlFor="arrival-photo"
              >
                {trip.arrivalPhotoUrl ? (
                  <div className="mb-3 flex flex-wrap items-start gap-3">
                    <StoredPhoto
                      src={trip.arrivalPhotoUrl}
                      alt=""
                      className="h-20 w-32 rounded-lg border border-border"
                      sizes="128px"
                    />
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="removeArrivalPhoto" className="size-4" />
                      {t("trips.details.arrivalPhotoRemove")}
                    </label>
                  </div>
                ) : null}
                <ImageFileInput
                  id="arrival-photo"
                  name="arrivalPhoto"
                  copy={{
                    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                    choose: t("trips.details.arrivalPhotoChoose"),
                    chooseAnother: t("trips.details.arrivalPhotoReplace"),
                  }}
                />
              </Field>
            </FieldGrid>
          </fieldset>
          <TripDiveFields
            diveSites={diveSiteList.map((site) => ({ id: site.id, name: site.name }))}
            initialCount={trip.plannedDives}
            initialDives={tripDiveList.map(({ dive }) => ({
              title: dive.title,
              diveSiteId: dive.diveSiteId,
              description: dive.description,
              travelMinutes: dive.travelMinutes,
            }))}
            copy={{
              heading: t("shared.tripDiveFields.heading"),
              description: t.raw("shared.tripDiveFields.description"),
              twoTankTrip: t("shared.tripDiveFields.twoTankTrip"),
              diveCountTripOne: t.raw("shared.tripDiveFields.diveCountTripOne"),
              diveCountTripOther: t.raw("shared.tripDiveFields.diveCountTripOther"),
              numberOfDivesLabel: t("shared.tripDiveFields.numberOfDivesLabel"),
              diveOptionOne: t.raw("shared.tripDiveFields.diveOptionOne"),
              diveOptionOther: t.raw("shared.tripDiveFields.diveOptionOther"),
              diveLegend: t.raw("shared.tripDiveFields.diveLegend"),
              nameLabel: t("shared.tripDiveFields.nameLabel"),
              optionalHint: t("shared.tripDiveFields.optionalHint"),
              namePlaceholderFirst: t("shared.tripDiveFields.namePlaceholderFirst"),
              namePlaceholderOther: t("shared.tripDiveFields.namePlaceholderOther"),
              diveSiteLabel: t("shared.tripDiveFields.diveSiteLabel"),
              noSiteChosen: t("shared.tripDiveFields.noSiteChosen"),
              travelLabelFirst: t("shared.tripDiveFields.travelLabelFirst"),
              travelLabelOther: t("shared.tripDiveFields.travelLabelOther"),
              travelHint: t("shared.tripDiveFields.travelHint"),
              diverFacingDetailsLabel: t("shared.tripDiveFields.diverFacingDetailsLabel"),
              footerNote: t("shared.tripDiveFields.footerNote"),
            }}
          />
          {/* Two rows of three, not one row of six. Six equal columns gave
              every box the same ~120px whatever it held — a date picker and a
              seat count side by side at the same width, with "Price per diver
              (optional)" wrapping to two lines while its neighbours sat on one
              and the whole caption row went ragged. Three columns is also the
              shape the schedule builder's own add panel uses, so the two places
              a departure's when-and-how-many is typed now look alike. */}
          <FieldGrid columns={3} className="gap-x-5 gap-y-5">
            <Field label={t("trips.details.dateLabel")}>
              <input
                name="date"
                type="date"
                required
                defaultValue={toDateInputValue(startWall)}
                className={controlClass}
              />
            </Field>
            <Field label={t("trips.details.departsLabel")}>
              <input
                name="startTime"
                type="time"
                required
                defaultValue={toTimeInputValue(startWall)}
                className={controlClass}
              />
            </Field>
            <Field label={t("trips.details.returnsLabel")}>
              <input
                name="endTime"
                type="time"
                required
                defaultValue={toTimeInputValue(endWall)}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <FieldGrid columns={3} className="gap-x-5 gap-y-5">
            <Field label={t("trips.details.capacityLabel")}>
              <input
                name="capacity"
                type="number"
                required
                min={1}
                max={60}
                defaultValue={trip.capacity}
                className={`${controlClass} tabular-nums`}
              />
            </Field>
            {/* The date/departs/returns boxes describe day one; this says how
              many consecutive days repeat it. Saving rebuilds the whole
              meeting-day list, so a departure can grow or shrink here rather
              than being deleted and rebuilt as separate trips. */}
            <Field label={t("trips.details.dayCountLabel")}>
              <input
                name="dayCount"
                type="number"
                required
                min={MIN_TRIP_DAYS}
                max={MAX_TRIP_DAYS}
                defaultValue={dayCount}
                className={`${controlClass} tabular-nums`}
              />
            </Field>
            <Field label={t("trips.details.priceLabel")} hint={t("trips.details.optionalHint")}>
              <input
                name="priceDollars"
                type="number"
                step={priceStep}
                min={0}
                max={maxPriceMajor(currency)}
                placeholder={pricePlaceholder}
                defaultValue={
                  trip.priceCents === null ? "" : minorToMajor(trip.priceCents, currency)
                }
                className={`${controlClass} tabular-nums`}
              />
            </Field>
          </FieldGrid>
          {/* **The departure's own three**, editable since issue #681. They
              used to be settable only when the departure was created, so the
              commonest real edit — the boat that was going to run this is in
              for service — meant delete and recreate, which `deleteTrip`
              refuses once anyone has booked.

              Course is deliberately absent: a departure's curriculum is what
              its divers bought. */}
          <FieldGrid columns={3} className="gap-x-5 gap-y-5">
            {modeOptions.length > 1 ? (
              // The same words the board's add panel uses, from the same keys:
              // the two forms describe one departure and must not call its
              // modes different things.
              <Field label={t("boats.diveModeLabel")}>
                <select
                  name="diveMode"
                  defaultValue={trip.diveMode ?? "boat"}
                  className={controlClass}
                >
                  {modeOptions.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(MODE_KEYS[mode])}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {hasBoatDiving && boats.length > 0 ? (
              <Field label={t("boats.boatSelectLabel")} hint={t("trips.details.optionalHint")}>
                <select name="boatId" defaultValue={trip.boatId ?? ""} className={controlClass}>
                  <option value="">{t("boats.unassignedBoat")}</option>
                  {boats.map((boat) => (
                    <option key={boat.id} value={boat.id}>
                      {boat.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={t("schedule.builder.isPrivateLabel")}>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="isPrivate"
                  defaultChecked={trip.isPrivate}
                  className="size-4"
                />
                {t("schedule.builder.isPrivateHint")}
              </label>
            </Field>
            {/* Silences the shop's own divemaster target for this departure and
                nothing else — an agency training ratio is a safety cap with its
                own module and a box cannot switch one off (issue #973). */}
            <Field label={t("schedule.builder.selfGuidedLabel")}>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="selfGuided"
                  defaultChecked={trip.selfGuided}
                  className="size-4"
                />
                {t("schedule.builder.selfGuidedHint")}
              </label>
            </Field>
          </FieldGrid>
          {/* A sunken inset, not a second card: this group sits *inside* the
              Details card, and surface never stacks on surface (see
              SectionCard's "what is not a section card"). */}
          <fieldset className="rounded-inset bg-surface-sunken p-4 sm:p-5">
            <legend className="px-1 text-sm font-medium">
              {t("trips.details.payAtBookingLegend")}
            </legend>
            <p className="text-sm text-muted">{t("trips.details.payAtBookingDescription")}</p>
            <FieldGrid columns={2} className="mt-4 gap-x-5 gap-y-5">
              <Field
                label={t("trips.details.depositLabel")}
                description={t("trips.details.depositDescription")}
              >
                <input
                  name="depositDollars"
                  type="number"
                  step={priceStep}
                  min={0}
                  max={maxPriceMajor(currency)}
                  placeholder={pricePlaceholder}
                  defaultValue={
                    trip.depositCents === null ? "" : minorToMajor(trip.depositCents, currency)
                  }
                  title={t("trips.details.depositTitle")}
                  className={`${controlClass} tabular-nums sm:w-40`}
                />
              </Field>
              <Field
                label={t("trips.details.cancellationWindowLabel")}
                description={t("trips.details.cancellationWindowDescription")}
              >
                <div className="flex items-center gap-2">
                  <input
                    name="cancellationWindowHours"
                    type="number"
                    step={1}
                    min={0}
                    max={720}
                    placeholder="48"
                    defaultValue={trip.cancellationWindowHours ?? ""}
                    className={`${controlClass} tabular-nums sm:w-28`}
                  />
                  <span className="text-sm text-muted">{t("trips.details.hoursSuffix")}</span>
                </div>
              </Field>
              <Field
                label={t("trips.details.minimumBookingsLabel")}
                description={t("trips.details.minimumBookingsDescription")}
              >
                <div className="flex items-center gap-2">
                  <input
                    name="minimumBookings"
                    type="number"
                    step={1}
                    min={1}
                    max={MAX_MINIMUM_BOOKINGS}
                    placeholder="4"
                    defaultValue={trip.minimumBookings ?? ""}
                    className={`${controlClass} tabular-nums sm:w-28`}
                  />
                  <span className="text-sm text-muted">{t("trips.details.diversSuffix")}</span>
                </div>
              </Field>
              <Field
                label={t("trips.details.minimumDecisionLabel")}
                description={t("trips.details.minimumDecisionDescription")}
              >
                <div className="flex items-center gap-2">
                  <input
                    name="minimumDecisionHours"
                    type="number"
                    step={1}
                    min={MIN_DECISION_HOURS}
                    max={MAX_DECISION_HOURS}
                    placeholder={String(MINIMUM_SEATS_DECISION_HOURS_DEFAULT)}
                    defaultValue={trip.minimumDecisionHours ?? ""}
                    className={`${controlClass} tabular-nums sm:w-28`}
                  />
                  <span className="text-sm text-muted">{t("trips.details.hoursBeforeSuffix")}</span>
                </div>
              </Field>
            </FieldGrid>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            {/* One open form at a time, one weight for its Save — the default
                primary, shared by all four Overview sections. */}
            <SubmitButton pendingLabel={t("trips.details.saving")} className={buttonClass()}>
              {t("trips.details.saveChanges")}
            </SubmitButton>
            <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
          </div>
        </form>
      </EditDisclosure>
    </SectionCard>
  );
}
