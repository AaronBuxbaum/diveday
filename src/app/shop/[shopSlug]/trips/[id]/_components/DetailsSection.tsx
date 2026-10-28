import type { ReactNode } from "react";
import { MeetingDaysField } from "@/app/shop/[shopSlug]/_components/MeetingDaysField";
import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import {
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldGrid,
  FormStatus,
  legendClass,
  textareaClassFor,
} from "@/components/ui/form";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { formatMoneyCents } from "@/lib/format";
import { WETSUIT_THICKNESS_MM } from "@/lib/gear";
import {
  MAX_DECISION_HOURS,
  MAX_MINIMUM_BOOKINGS,
  MIN_DECISION_HOURS,
  MINIMUM_SEATS_DECISION_HOURS_DEFAULT,
} from "@/lib/minimum-seats";
import { currencyFractionDigits, maxPriceMajor, minorToMajor } from "@/lib/money";
import { offeredRentableItems } from "@/lib/rentals";
import type { FormNotice } from "@/lib/staff-notices";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { toDateInputValue, toTimeInputValue, type WallTime } from "@/lib/zoned";
import type { DepartureDetailsSection } from "../departure-detail-sections";
import { BoatCapacityWarning } from "./BoatCapacityWarning";
import type { DiveSiteList, Trip, TripDiveList } from "./types";

/**
 * The frame of a group inside the Details card: a sunken inset, not a second
 * card, because surface never stacks on surface (see SectionCard's "what is
 * not a section card"). Arrival guidance, the Dive plan and Pay at booking
 * wear it, spelled once so none of them drifts (pixel-craft K-95).
 */
const GROUP_INSET = "rounded-inset bg-surface-sunken p-4 sm:p-5";

/** Everything `DetailsSection` draws, assembled once by its caller and handed over as one object. */
export type { DepartureDetailsSection } from "../departure-detail-sections";

export type DetailsSectionContext = {
  action: (formData: FormData) => void;
  /** This form's own outcome, rendered beside its Save button rather than at the top of the page. */
  status?: FormNotice;
  trip: Trip;
  diveSiteList: DiveSiteList;
  tripDiveList: TripDiveList;
  startWall: WallTime;
  endWall: WallTime;
  /** How many days this departure meets on — its `trip_schedule_days` count. */
  dayCount: number;
  /** One date per later day when the days are not consecutive; empty otherwise. */
  laterDates: string[];
  /** The shop's live fleet, for the hull select. Empty means no boat rows yet. */
  boats: { id: string; name: string; capacity: number }[];
  /** The shop's trip tags, in the order it wrote them. */
  lenses: { id: string; name: string }[];
  hasBoatDiving: boolean;
  hasShoreDiving: boolean;
  hasPoolDiving: boolean;
  /** The shop's rental catalog: renting wetsuits makes the day's thickness worth asking (#2206). */
  rentalItems: readonly string[];
  locale: string;
  /** The shop's currency — what the numbers in these price boxes mean. */
  currency: string;
  /** Claude's Draft button for the description, inside this form; absent while dark. */
  descriptionAssist?: ReactNode;
  /**
   * Divers the night-before email told a fly-safe wait, not yet corrected
   * (#2927): said beside the decompression box, which corrects them.
   */
  flySafeTold?: number;
};

/** The departure's title and description, and Claude's Draft button under the description. */
function TitleAndDescription({
  trip,
  assist,
  t,
}: {
  trip: Trip;
  assist?: ReactNode;
  t: StaffTranslator;
}) {
  return (
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
      <Field label={t("trips.details.descriptionLabel")} hint={t("trips.details.optionalHint")}>
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={trip.description ?? ""}
          className={textareaClassFor(2)}
        />
        {assist ? <div className="mt-2">{assist}</div> : null}
      </Field>
    </FieldGrid>
  );
}

function MeetingPointFields({ trip, t }: { trip: Trip; t: StaffTranslator }) {
  return (
    <>
      <FieldGrid columns={2}>
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
      <details className="group/arrival">
        <summary className="cursor-pointer text-sm font-medium text-primary">
          {t("trips.details.arrivalGuidanceLegend")}
        </summary>
        <p className="text-sm text-muted">{t("trips.details.arrivalGuidanceDescription")}</p>
        <FieldGrid columns={2} className="mt-4">
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
              className={textareaClassFor(2)}
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
              className={textareaClassFor(2)}
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
              className={textareaClassFor(2)}
            />
          </Field>
          <Field
            label={t("trips.details.arrivalParkingLabel")}
            hint={t("trips.details.optionalHint")}
          >
            <textarea
              name="arrivalParkingNote"
              rows={2}
              maxLength={300}
              defaultValue={trip.arrivalParkingNote ?? ""}
              className={textareaClassFor(2)}
            />
          </Field>
          <Field
            label={t("trips.details.arrivalTransitLabel")}
            hint={t("trips.details.optionalHint")}
          >
            <textarea
              name="arrivalTransitNote"
              rows={2}
              maxLength={300}
              defaultValue={trip.arrivalTransitNote ?? ""}
              className={textareaClassFor(2)}
            />
          </Field>
          <Field
            label={t("trips.details.arrivalPhotoLabel")}
            hint={t("trips.details.optionalHint")}
            description={t("trips.details.arrivalPhotoDescription")}
            htmlFor="arrival-photo"
          >
            {/* The shared removable photo; `on` is what the save reads. This
                field is a half column from `sm` up, so the photo takes the
                column, as the dive-site editor's map and route stills do: in
                the gallery's three-across grid it was a third of a half. */}
            <div className="flex flex-col gap-3">
              {trip.arrivalPhotoUrl ? (
                <RemovablePhoto
                  url={trip.arrivalPhotoUrl}
                  name="removeArrivalPhoto"
                  value="on"
                  label={t("trips.details.arrivalPhotoRemove")}
                />
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
            </div>
          </Field>
        </FieldGrid>
      </details>
    </>
  );
}

export function DetailsSection({
  context,
  section,
}: {
  context: DetailsSectionContext;
  section: DepartureDetailsSection;
}) {
  const {
    action,
    status,
    trip,
    diveSiteList,
    tripDiveList,
    startWall,
    endWall,
    dayCount,
    laterDates,
    locale,
    currency,
    boats,
    lenses,
    hasBoatDiving,
    flySafeTold = 0,
  } = context;
  const t = staffTranslator(locale);
  // Both price boxes follow the shop's currency: whole-number entry and a
  // symbol-only placeholder for a zero-decimal currency, where "$0.00" was
  // wrong twice over.
  const digits = currencyFractionDigits(currency);
  const modeOptions = departureModes(context);
  const priceStep = digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
  const pricePlaceholder = formatMoneyCents(0, currency, locale);
  return (
    <form action={action} encType="multipart/form-data" className="flex flex-col gap-5 pt-1">
      {section === "departure" ? (
        <>
          <TitleAndDescription trip={trip} assist={context.descriptionAssist} t={t} />
          <FieldGrid columns={2}>
            {/* The shop's own word for this kind of day (ADR
                20260904-reef-all-the-way-down, decision 2). Renders nothing
                when the shop has written no vocabulary, exactly as the boat
                select renders nothing with no hulls. */}
            {lenses.length > 0 ? (
              <Field label={t("lenses.tripFieldLabel")} hint={t("trips.details.optionalHint")}>
                <select name="lensId" defaultValue={trip.lensId ?? ""} className={controlClass}>
                  <option value="">{t("lenses.tripFieldNone")}</option>
                  {lenses.map((lens) => (
                    <option key={lens.id} value={lens.id}>
                      {lens.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </FieldGrid>
        </>
      ) : null}
      {section === "meeting" ? <MeetingPointFields trip={trip} t={t} /> : null}
      {section === "plan" ? (
        <>
          <TripDiveFields
            id="dives"
            frameClassName=""
            advancedLabel={t("trips.details.diveDetails")}
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
          <WetsuitThicknessField
            rentalItems={context.rentalItems}
            t={t}
            mm={trip.wetsuitThicknessMm}
          />
          <AboardFields t={t} trip={trip} flySafeTold={flySafeTold} />
        </>
      ) : null}
      {section === "timing" ? (
        <>
          <FieldGrid columns={3}>
            <Field label={t("trips.details.dateLabel")}>
              <DateField name="date" required defaultValue={toDateInputValue(startWall)} />
            </Field>
            <Field label={t("trips.details.departsLabel")}>
              <DateField
                name="startTime"
                type="time"
                required
                defaultValue={toTimeInputValue(startWall)}
              />
            </Field>
            <Field label={t("trips.details.returnsLabel")}>
              <DateField
                name="endTime"
                type="time"
                required
                defaultValue={toTimeInputValue(endWall)}
              />
            </Field>
          </FieldGrid>
          {/* The date/departs/returns boxes describe day one; this says how
            many days repeat it, and on which dates once gaps are allowed
            (third UX review, item 10; `MAX_MEETING_DAY_GAP_DAYS`). Saving rebuilds the whole
            meeting-day list, so a departure can grow or shrink here rather
            than being deleted and rebuilt as separate trips. */}
          <MeetingDaysField
            copy={{
              daysLabel: t("trips.details.dayCountLabel"),
              dayLabel: t.raw("schedule.builder.meetingDayLabel"),
            }}
            minDays={MIN_TRIP_DAYS}
            maxDays={MAX_TRIP_DAYS}
            defaultCount={dayCount}
            defaultLaterDates={laterDates}
          />
        </>
      ) : null}
      {section === "booking" ? (
        <>
          <FieldGrid columns={3}>
            <Field
              label={t("trips.details.capacityLabel")}
              description={
                <BoatCapacityWarning
                  boats={boats}
                  initialMode={trip.diveMode ?? "boat"}
                  assignedBoatId={trip.boatId}
                  currentCapacity={trip.capacity}
                  copy={t.raw("schedule.builder.boatCapacityWarning")}
                />
              }
            >
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
            <PriceField {...{ trip, currency, locale, priceStep, pricePlaceholder, t }} />
          </FieldGrid>
          <Field label={t("schedule.builder.isPrivateLabel")} htmlFor="trip-details-is-private">
            <ChoiceRow
              type="checkbox"
              id="trip-details-is-private"
              name="isPrivate"
              defaultChecked={trip.isPrivate}
              className="text-sm"
            >
              {t("schedule.builder.isPrivateHint")}
            </ChoiceRow>
          </Field>
          <PayAtBookingFields
            t={t}
            trip={trip}
            currency={currency}
            priceStep={priceStep}
            pricePlaceholder={pricePlaceholder}
          />
        </>
      ) : null}
      {section === "boat" ? (
        <>
          <FieldGrid columns={3}>
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
              <Field
                label={t("boats.boatSelectLabel")}
                hint={t("trips.details.optionalHint")}
                description={
                  <BoatCapacityWarning
                    boats={boats}
                    initialMode={trip.diveMode ?? "boat"}
                    assignedBoatId={trip.boatId}
                    currentCapacity={trip.capacity}
                    copy={t.raw("schedule.builder.boatCapacityWarning")}
                  />
                }
              >
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
          </FieldGrid>
          {trip.courseId ? null : <SelfGuidedField t={t} checked={trip.selfGuided} />}
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel={t("trips.details.saving")} className={buttonClass()}>
          {t("trips.details.saveChanges")}
        </SubmitButton>
        <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
      </div>
    </form>
  );
}

/**
 * **Pay at booking**: the deposit, the free-cancellation window and the
 * departure's minimum head count with the hour it is decided, in the shop's
 * currency. One group inside the Details form, wearing `GROUP_INSET`.
 */
const MODE_KEYS = {
  boat: "boats.modeBoat",
  shore: "boats.modeShore",
  pool: "boats.modePool",
} as const;

/**
 * Only the modes this shop actually runs, same rule the add panel applies — a
 * departure must not be switchable to a kind of diving the shop has said it
 * does not do. One option is no choice, so the select does not render.
 */
function departureModes(
  shop: Pick<DetailsSectionContext, "hasBoatDiving" | "hasShoreDiving" | "hasPoolDiving">,
) {
  return (["boat", "shore", "pool"] as const).filter((mode) =>
    mode === "boat"
      ? shop.hasBoatDiving
      : mode === "shore"
        ? shop.hasShoreDiving
        : shop.hasPoolDiving,
  );
}

/**
 * The wetsuit the boat is running today (issue #2206): what the Gear tab
 * matches a wetsuit's thickness against. Blank proposes no wetsuit at all, and
 * a staffer picks one as before. Shown only where the shop rents wetsuits.
 */
function WetsuitThicknessField({
  rentalItems,
  t,
  mm,
}: {
  rentalItems: readonly string[];
  t: StaffTranslator;
  mm: number | null;
}) {
  if (!offeredRentableItems(rentalItems).some((item) => item.kind === "wetsuit")) return null;
  return (
    <FieldGrid columns={3}>
      <Field
        label={t("trips.details.wetsuitThicknessLabel")}
        hint={t("trips.details.optionalHint")}
      >
        <input
          name="wetsuitThicknessMm"
          type="number"
          inputMode="numeric"
          step={1}
          min={WETSUIT_THICKNESS_MM.min}
          max={WETSUIT_THICKNESS_MM.max}
          defaultValue={mm ?? ""}
          className={`${controlClass} tabular-nums`}
        />
      </Field>
    </FieldGrid>
  );
}

function PayAtBookingFields({
  t,
  trip,
  currency,
  priceStep,
  pricePlaceholder,
}: {
  t: StaffTranslator;
  trip: Trip;
  currency: string;
  priceStep: string;
  pricePlaceholder: string;
}) {
  return (
    <fieldset className={GROUP_INSET}>
      <legend className={`${legendClass} text-sm font-medium`}>
        {t("trips.details.payAtBookingLegend")}
      </legend>
      <p className="text-sm text-muted">{t("trips.details.payAtBookingDescription")}</p>
      <FieldGrid columns={2} className="mt-4">
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
  );
}

/**
 * The departure's switches, in a grid of their own two across, so the last
 * one never sits alone under three selects in a narrow column (visual
 * triage, round 5).
 */

/**
 * H-84 (issue #1555): DAN gives no preflight figure for a dive that took
 * stops, so a departure marked here gets no flying sentence on the recap.
 * Nothing else reads it.
 */
function DecompressionField({
  t,
  checked,
  flySafeTold,
}: {
  t: StaffTranslator;
  checked: boolean;
  flySafeTold: number;
}) {
  return (
    <Field label={t("trips.details.exceedsNoDecoLabel")} htmlFor="trip-details-exceeds-no-deco">
      <ChoiceRow
        type="checkbox"
        id="trip-details-exceeds-no-deco"
        name="exceedsNoDecoLimits"
        defaultChecked={checked}
        className="text-sm"
      >
        {t("trips.details.exceedsNoDecoHint")}
      </ChoiceRow>
      {/* Divers already holding a fly-safe figure this box makes wrong (#2927). */}
      {flySafeTold > 0 ? (
        <p className="mt-2 text-sm font-medium text-warning-strong">
          {t("trips.details.exceedsNoDecoTold", { count: flySafeTold })}
        </p>
      ) : null}
    </Field>
  );
}

/** What the day aboard asks of the plan: deco, and lunch served (item 56). */
function AboardFields({
  t,
  trip,
  flySafeTold,
}: {
  t: StaffTranslator;
  trip: { exceedsNoDecoLimits: boolean; lunchAboard: boolean };
  flySafeTold: number;
}) {
  return (
    <>
      <DecompressionField t={t} checked={trip.exceedsNoDecoLimits} flySafeTold={flySafeTold} />
      <LunchAboardField t={t} checked={trip.lunchAboard} />
    </>
  );
}

/** Lunch served aboard (fifth-loop ideas, item 56): asks each diver's dietary note. */
function LunchAboardField({ t, checked }: { t: StaffTranslator; checked: boolean }) {
  return (
    <Field label={t("trips.details.lunchAboardLabel")} htmlFor="trip-details-lunch-aboard">
      <ChoiceRow
        type="checkbox"
        id="trip-details-lunch-aboard"
        name="lunchAboard"
        defaultChecked={checked}
        className="text-sm"
      >
        {t("trips.details.lunchAboardHint")}
      </ChoiceRow>
    </Field>
  );
}

function SelfGuidedField({ t, checked }: { t: StaffTranslator; checked: boolean }) {
  return (
    <Field label={t("schedule.builder.selfGuidedLabel")} htmlFor="trip-details-self-guided">
      <ChoiceRow
        type="checkbox"
        id="trip-details-self-guided"
        name="selfGuided"
        defaultChecked={checked}
        className="text-sm"
      >
        {t("schedule.builder.selfGuidedHint")}
      </ChoiceRow>
    </Field>
  );
}

/**
 * **A priced course holds the price, not its session** (fourth UX review,
 * item 26): checkout charges the course fee plus its eLearning fee and ignores
 * the departure's own figure, so an editable box here set a number nobody is
 * charged. The session states the course's total instead; the stored value
 * rides along unchanged, so a save never clears it.
 */
function PriceField({
  trip,
  currency,
  locale,
  priceStep,
  pricePlaceholder,
  t,
}: {
  trip: Trip;
  currency: string;
  locale: string;
  priceStep: string;
  pricePlaceholder: string;
  t: StaffTranslator;
}) {
  const stored = trip.priceCents === null ? "" : minorToMajor(trip.priceCents, currency);
  if (trip.course && trip.course.priceCents !== null) {
    const coursePriceCents = perDiverBookingPriceCents(trip, trip.course) ?? 0;
    return (
      <Field group label={t("trips.details.priceLabel")} hint={t("trips.details.coursePriceHint")}>
        <p className="py-2 text-sm tabular-nums">
          {t("trips.details.coursePrice", {
            amount: formatMoneyCents(coursePriceCents, currency, locale),
          })}
        </p>
        <input type="hidden" name="priceDollars" value={stored} />
      </Field>
    );
  }
  return (
    <Field label={t("trips.details.priceLabel")} hint={t("trips.details.optionalHint")}>
      <input
        name="priceDollars"
        type="number"
        step={priceStep}
        min={0}
        max={maxPriceMajor(currency)}
        placeholder={pricePlaceholder}
        defaultValue={stored}
        className={`${controlClass} tabular-nums`}
      />
    </Field>
  );
}
