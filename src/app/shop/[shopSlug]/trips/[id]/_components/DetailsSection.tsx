import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import { currencyFractionDigits, maxPriceMajor, minorToMajor } from "@/lib/money";
import type { FormNotice } from "@/lib/staff-notices";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { toDateInputValue, toTimeInputValue, type WallTime } from "@/lib/zoned";
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
  return (
    // Anchor target for the builder's "No price set" flag (task 150, UX
    // persona lens 17) — a builder-created trip publishes with no price and
    // no warning; this is where staff land to fix it.
    <section id="details" className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold">{t("trips.details.heading")}</h2>
      <form action={action} className="mt-4 flex flex-col gap-5">
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
          }))}
          copy={{
            heading: t("shared.tripDiveFields.heading"),
            description: t("shared.tripDiveFields.description"),
            twoTankTrip: t("shared.tripDiveFields.twoTankTrip"),
            diveCountTrip: t("shared.tripDiveFields.diveCountTrip"),
            numberOfDivesLabel: t("shared.tripDiveFields.numberOfDivesLabel"),
            diveOptionOne: t("shared.tripDiveFields.diveOptionOne"),
            diveOptionOther: t("shared.tripDiveFields.diveOptionOther"),
            diveLegend: t("shared.tripDiveFields.diveLegend"),
            nameLabel: t("shared.tripDiveFields.nameLabel"),
            optionalHint: t("shared.tripDiveFields.optionalHint"),
            namePlaceholderFirst: t("shared.tripDiveFields.namePlaceholderFirst"),
            namePlaceholderOther: t("shared.tripDiveFields.namePlaceholderOther"),
            diveSiteLabel: t("shared.tripDiveFields.diveSiteLabel"),
            noSiteChosen: t("shared.tripDiveFields.noSiteChosen"),
            diverFacingDetailsLabel: t("shared.tripDiveFields.diverFacingDetailsLabel"),
            detailsPlaceholder: t("shared.tripDiveFields.detailsPlaceholder"),
            footerNote: t("shared.tripDiveFields.footerNote"),
          }}
        />
        <FieldGrid columns={1} className="gap-x-5 gap-y-5 sm:grid-cols-6">
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
              defaultValue={trip.priceCents === null ? "" : minorToMajor(trip.priceCents, currency)}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border bg-surface p-5">
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
          </FieldGrid>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel={t("trips.details.saving")}
            className={buttonClass({ size: "lg", className: "text-base" })}
          >
            {t("trips.details.saveChanges")}
          </SubmitButton>
          <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
        </div>
      </form>
    </section>
  );
}
