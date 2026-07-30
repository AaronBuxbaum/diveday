import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { toDateInputValue, toTimeInputValue, type WallTime } from "@/lib/zoned";
import type { DiveSiteList, Trip, TripDiveList } from "./types";

export function DetailsSection({
  action,
  trip,
  diveSiteList,
  tripDiveList,
  startWall,
  endWall,
  locale,
}: {
  action: (formData: FormData) => void;
  trip: Trip;
  diveSiteList: DiveSiteList;
  tripDiveList: TripDiveList;
  startWall: WallTime;
  endWall: WallTime;
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10">
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
        />
        <FieldGrid columns={1} className="gap-x-5 gap-y-5 sm:grid-cols-5">
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
          <Field label={t("trips.details.priceLabel")} hint={t("trips.details.optionalHint")}>
            <input
              name="priceDollars"
              type="number"
              step="0.01"
              min={0}
              placeholder="$0.00"
              defaultValue={trip.priceCents === null ? "" : (trip.priceCents / 100).toFixed(2)}
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
              hint={t("trips.details.optionalHint")}
              description={t("trips.details.depositDescription")}
            >
              <input
                name="depositDollars"
                type="number"
                step="0.01"
                min={0}
                placeholder="$0.00"
                defaultValue={
                  trip.depositCents === null ? "" : (trip.depositCents / 100).toFixed(2)
                }
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
            <Field
              label={t("trips.details.cancellationWindowLabel")}
              hint={t("trips.details.optionalHint")}
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
        <div>
          <SubmitButton
            pendingLabel={t("trips.details.saving")}
            className={buttonClass({ size: "lg", className: "text-base" })}
          >
            {t("trips.details.saveChanges")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
