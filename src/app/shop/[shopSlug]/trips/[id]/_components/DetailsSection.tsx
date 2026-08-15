import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
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
  locale: string;
  /** The shop's currency — what the numbers in these price boxes mean. */
  currency: string;
}) {
  const t = staffTranslator(locale);
  // Both price boxes follow the shop's currency: whole-number entry and a
  // symbol-only placeholder for a zero-decimal currency, where "$0.00" was
  // wrong twice over.
  const digits = currencyFractionDigits(currency);
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
    <section id="details" className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold">{t("trips.details.heading")}</h2>
      {trip.description ? (
        <p className="mt-1 max-w-2xl text-sm text-muted">{trip.description}</p>
      ) : null}
      {/* The missing price is a problem and wears warning ink alone; settled
          facts (deposit, cancellation window) stay muted rather than
          inheriting the alarm. */}
      {trip.priceCents === null ? (
        <p className="mt-1 text-sm font-medium text-warning-strong">
          {t("trips.details.summaryNoPrice")}
        </p>
      ) : null}
      {moneyFacts.length > 0 ? (
        <p className="mt-1 text-sm text-muted">{moneyFacts.join(" · ")}</p>
      ) : null}
      <EditDisclosure label={t("trips.details.edit")} open={Boolean(status)}>
        <form action={action} className="mt-2 flex flex-col gap-5">
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
              diveCountTrip: t.raw("shared.tripDiveFields.diveCountTrip"),
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
              detailsPlaceholder: t("shared.tripDiveFields.detailsPlaceholder"),
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
          <fieldset className={sectionCardClass({ padding: "lg" })}>
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
    </section>
  );
}
