import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { compassText } from "@/i18n/compass-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  type DepthUnit,
  depthInUnit,
  maxEnteredVisibility,
  waveHeightInUnit,
} from "@/lib/depth-units";
import { formatDateTimeTz, formatTime } from "@/lib/format";
import { type AutomatedMarineForecast, hasCrewPrediction } from "@/lib/marine-forecast";
import type { FormNotice } from "@/lib/staff-notices";
import {
  maxEnteredTemperature,
  minEnteredTemperature,
  type TemperatureUnit,
  temperatureInUnit,
} from "@/lib/temperature-units";
import { EditDisclosure } from "./EditDisclosure";
import type { Trip } from "./types";

export function ConditionsSection({
  saveAction,
  status,
  clearAction,
  trip,
  locale,
  timezone,
  temperatureUnit,
  depthUnit,
  automatedForecast,
  embedded = false,
}: {
  saveAction: (formData: FormData) => void;
  /** This form's own outcome, rendered beside its Publish button. */
  status?: FormNotice;
  clearAction: () => void;
  trip: Trip;
  locale: string;
  /** The shop's zone — when the publish time is read back, it reads in it. */
  timezone: string;
  /** The shop's own units — the crew type in these; storage stays Celsius and metres. */
  temperatureUnit: TemperatureUnit;
  depthUnit: DepthUnit;
  automatedForecast?: AutomatedMarineForecast | null;
  /** The Trip surface's About panel supplies the outer section chrome. */
  embedded?: boolean;
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
  const published = hasCrewPrediction(trip);
  /**
   * Whether the marine model said anything at all. Every reading it can carry,
   * not the three it used to be asked about — a forecast holding only water
   * temperature is still a forecast.
   */
  const hasAutomatedOutlook = Boolean(
    automatedForecast &&
      (automatedForecast.waterTemperatureC !== null ||
        automatedForecast.surface ||
        automatedForecast.wind ||
        automatedForecast.current ||
        automatedForecast.sun),
  );
  // The published read, said back as facts — what a crew member checks at a
  // glance without opening the form. Each piece renders only when recorded.
  const publishedFacts = [
    trip.waterTemperatureC !== null
      ? `${temperatureInUnit(trip.waterTemperatureC, temperatureUnit)} ${temperatureUnitLabel}`
      : null,
    // "18 m" alone carries a unit but no subject — an operational read names
    // what the figure measures (principle 6).
    trip.visibilityMeters !== null
      ? t("trips.conditions.visibilityFact", {
          value: `${depthInUnit(trip.visibilityMeters, depthUnit)} ${depthUnitLabel}`,
        })
      : null,
    trip.surfaceConditions,
  ].filter((part): part is string => Boolean(part));
  return (
    <SectionCard
      id="conditions"
      padding={embedded ? "none" : "lg"}
      title={t("trips.conditions.heading")}
      className={`${embedded ? "!rounded-none !border-0 !bg-transparent" : ""} scroll-mt-24`}
    >
      {/* A hold pauses real bookings, so it must be readable without opening
          anything — warning ink, not a fact that waits behind the form. */}
      {trip.conditionsHold ? (
        <p className="mb-1 text-sm font-medium text-warning-strong">
          {t("trips.conditions.holdOnSummary")}
        </p>
      ) : null}
      {published ? (
        <div className="text-sm text-muted">
          {/* No bold lead-in label: it restated the heading one line up at
              equal weight (design/principles.md #9) — the "Published …"
              timestamp below already says this is the published read. The
              facts line carries the ink instead. */}
          <p className="font-medium text-foreground">{publishedFacts.join(" · ")}</p>
          {trip.conditionsSummary ? <p className="mt-1">{trip.conditionsSummary}</p> : null}
          {/* An operational read must never look fresher than it is (design
              principle 4's safety carve-out) — the publish time rides with
              the facts, in the shop's own zone. */}
          {trip.conditionsUpdatedAt ? (
            <p className="mt-1">
              {t("trips.conditions.publishedAt", {
                date: formatDateTimeTz(trip.conditionsUpdatedAt, locale, timezone),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("trips.conditions.description")}</p>
      )}
      {/* **The model's read, whether or not the crew has published theirs.**
          This block used to render only when the forecast carried wind,
          current or sun — so a model answering with the two readings the crew
          themselves record, water temperature and the sea surface, rendered
          nothing at all. It is also the half a crew most wants beside their
          own: publishing a prediction never used to hide this, but there was
          nothing here to compare a published water temp against. Both
          readings now show, on both states. */}
      {hasAutomatedOutlook ? (
        <div className="mt-3 rounded-lg bg-surface-sunken p-3 text-xs text-muted">
          <p className="font-medium text-foreground">
            {t("trips.conditions.automatedOutlookHeading")}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {automatedForecast?.waterTemperatureC !== null &&
            automatedForecast?.waterTemperatureC !== undefined ? (
              <span>
                {t("trips.conditions.automatedWater", {
                  value: `${temperatureInUnit(automatedForecast.waterTemperatureC, temperatureUnit)} ${temperatureUnitLabel}`,
                })}
              </span>
            ) : null}
            {automatedForecast?.surface ? (
              // Significant wave height as the model publishes it, in the
              // shop's own depth unit. The diver-facing page turns this into a
              // band ("light chop") on purpose — a captain reads the number,
              // and this is the captain's page.
              //
              // `waveHeightInUnit`, never `depthInUnit`: that one rounds to
              // whole units because a site's maximum depth is a briefing
              // figure, and every ordinary day on a reef boat is under a metre
              // — it would render flat calm, pleasant and rough as 0, 1 and 1.
              <span>
                {t("trips.conditions.automatedSeas", {
                  height: `${waveHeightInUnit(automatedForecast.surface.waveHeightMeters, depthUnit)} ${depthUnitLabel}`,
                  direction: compassText(t, automatedForecast.surface.waveDirection),
                })}
              </span>
            ) : null}
            {automatedForecast?.wind ? (
              <span>
                {t("trips.conditions.automatedWind", {
                  speed: automatedForecast.wind.speedKnots,
                  direction: compassText(t, automatedForecast.wind.direction),
                  gusts: automatedForecast.wind.gustsKnots ?? 0,
                  hasGusts:
                    automatedForecast.wind.gustsKnots !== null &&
                    automatedForecast.wind.gustsKnots > automatedForecast.wind.speedKnots
                      ? "yes"
                      : "no",
                })}
              </span>
            ) : null}
            {automatedForecast?.current ? (
              <span>
                {t("trips.conditions.automatedCurrent", {
                  velocity: automatedForecast.current.velocityKnots,
                  direction: compassText(t, automatedForecast.current.direction),
                })}
              </span>
            ) : null}
            {automatedForecast?.sun?.sunrise && automatedForecast.sun?.sunset ? (
              <span>
                {t("trips.conditions.automatedSun", {
                  sunrise: formatTime(automatedForecast.sun.sunrise, locale, timezone),
                  sunset: formatTime(automatedForecast.sun.sunset, locale, timezone),
                })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <EditDisclosure
        label={published ? t("trips.conditions.editPublished") : t("trips.conditions.editEmpty")}
        open={Boolean(status)}
      >
        <form action={saveAction} className="mt-3 flex flex-col gap-5">
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
                  trip.visibilityMeters === null
                    ? ""
                    : depthInUnit(trip.visibilityMeters, depthUnit)
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
            <SubmitButton pendingLabel={t("trips.conditions.publishing")} className={buttonClass()}>
              {t("trips.conditions.publish")}
            </SubmitButton>
            <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
          </div>
        </form>
        {published ? (
          <form action={clearAction} className="mt-1">
            {/* The rare escape hatch, not a second action of equal weight:
                link-weight beside the section's one primary (principle 8). */}
            <SubmitButton
              pendingLabel={t("trips.conditions.clearing")}
              className={buttonClass({ variant: "link", size: "sm" })}
            >
              {t("trips.conditions.returnToAutomated")}
            </SubmitButton>
          </form>
        ) : null}
      </EditDisclosure>
    </SectionCard>
  );
}
