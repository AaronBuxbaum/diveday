import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit, maxEnteredVisibility } from "@/lib/depth-units";
import { hasCrewPrediction } from "@/lib/marine-forecast";
import {
  maxEnteredTemperature,
  minEnteredTemperature,
  type TemperatureUnit,
  temperatureInUnit,
} from "@/lib/temperature-units";
import type { Trip } from "./types";

export function ConditionsSection({
  saveAction,
  status,
  clearAction,
  trip,
  locale,
  temperatureUnit,
  depthUnit,
}: {
  saveAction: (formData: FormData) => void;
  clearAction: () => void;
  trip: Trip;
  locale: string;
  /** The shop's own units — the crew type in these; storage stays Celsius and metres. */
  temperatureUnit: TemperatureUnit;
  depthUnit: DepthUnit;
}) {
  const t = staffTranslator(locale);
  // The unit belongs in the label, not as a hint beside it: a crew member
  // reading a bare "Water temp" types whichever unit they think in, and a 27
  // meant as °F would reach every diver's night-before brief as an 81°F day.
  const temperatureUnitLabel = t(
    temperatureUnit === "fahrenheit"
      ? "shared.temperature.fahrenheit"
      : "shared.temperature.celsius",
  );
  const depthUnitLabel = t(depthUnit === "feet" ? "shared.depth.feet" : "shared.depth.meters");
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{t("trips.conditions.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.conditions.description")}</p>
      <form action={saveAction} className="mt-5 flex flex-col gap-5">
        <label className="flex min-h-11 max-w-2xl items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <input
            id="conditions-hold"
            type="checkbox"
            name="conditionsHold"
            defaultChecked={trip.conditionsHold}
            className="mt-1 size-5 accent-current"
          />
          <span>
            <span className="font-semibold">{t("trips.conditions.holdLabel")}</span>
            <span className="mt-0.5 block text-sm text-muted">
              {t("trips.conditions.holdDescription")}
            </span>
          </span>
        </label>
        <FieldGrid columns={1} className="max-w-2xl">
          <Field label={t("trips.conditions.overviewLabel")}>
            <textarea
              name="conditionsSummary"
              rows={2}
              maxLength={600}
              defaultValue={trip.conditionsSummary ?? ""}
              placeholder={t("trips.conditions.overviewPlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={3} className="gap-x-5 gap-y-5">
          <Field label={t("trips.conditions.waterTempLabel", { unit: temperatureUnitLabel })}>
            <input
              name="waterTemperature"
              type="number"
              min={minEnteredTemperature(temperatureUnit)}
              max={maxEnteredTemperature(temperatureUnit)}
              defaultValue={
                trip.waterTemperatureC === null
                  ? ""
                  : temperatureInUnit(trip.waterTemperatureC, temperatureUnit)
              }
              className={controlClass}
            />
          </Field>
          <Field label={t("trips.conditions.visibilityLabel", { unit: depthUnitLabel })}>
            <input
              name="visibility"
              type="number"
              min={0}
              max={maxEnteredVisibility(depthUnit)}
              defaultValue={
                trip.visibilityMeters === null ? "" : depthInUnit(trip.visibilityMeters, depthUnit)
              }
              className={controlClass}
            />
          </Field>
          <Field label={t("trips.conditions.surfaceNotesLabel")}>
            <input
              name="surfaceConditions"
              maxLength={300}
              defaultValue={trip.surfaceConditions ?? ""}
              placeholder={t("trips.conditions.surfaceNotesPlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel={t("trips.conditions.publishing")}
            className={buttonClass({
              variant: "secondary",
              className: "text-foreground",
            })}
          >
            {t("trips.conditions.publish")}
          </SubmitButton>
          <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
        </div>
      </form>
      {hasCrewPrediction(trip) ? (
        <form action={clearAction} className="mt-3">
          <SubmitButton
            pendingLabel={t("trips.conditions.clearing")}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("trips.conditions.returnToAutomated")}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
