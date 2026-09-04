import { Fragment } from "react";
import { diverTranslator } from "@/i18n/messages";
import { depthText, seaStateText, temperatureText, windText } from "@/i18n/unit-labels";
import { formatDateTimeTz } from "@/lib/format";
import { seaStateReading, windReading } from "@/lib/marine-forecast";
import { temperatureUnitFor } from "@/lib/temperature-units";
import type { AutomatedForecast, Shop, Trip } from "./types";

/**
 * **One line of "what the day is like", between the pitch and the ask.**
 *
 * ADR 20260827-the-divers-thread, decision 2: the trip page sells, then closes
 * — hero, pitch, one-line requirement, then the form, terminal. This is the
 * last beat of the pitch, and it is a *line* rather than a section because it
 * used to be four sunken tiles in a `<dl>` under an eyebrow heading, sitting
 * **below** the booking form where only a diver who had already bought would
 * ever scroll to it. Four boxes of numbers weigh the same as the purchase; one
 * line of them answers "is this my day?" on the way past.
 *
 * What it drops, deliberately: the exposure-suit advice under the water
 * temperature and the sea-state detail sentence. Both are *preparation*, and
 * preparation moved to the thread with `PackingSection` — which still renders
 * them, on `/ready`, for the diver who is now packing a bag.
 *
 * What it keeps verbatim: **the Open-Meteo credit, with its link.** Their
 * license (open-meteo.com/en/license) requires attribution *with* a link back,
 * so the automated path always carries it. A crew's own prediction is the
 * shop's own reading and needs no credit; a departure with neither forecast
 * still renders this line for the languages aboard.
 */
export function ConditionsLine({
  shop,
  trip,
  crewPrediction,
  automatedForecast,
  crewLanguages,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  crewPrediction: boolean;
  automatedForecast: AutomatedForecast;
  /**
   * The languages aboard, already formatted into the reader's own list
   * grammar by the page. Null when the crew have declared none.
   *
   * Crew *names* are still not here, and for the same reason:
   * `tripCrewSpokenLanguages` is an aggregate on purpose — "it names no crew
   * member and makes no promise about a particular guide" — and this line is
   * about conditions.
   *
   * The disclosure decision this used to defer has since been made, and it was
   * made as a *consent* rather than as a layout choice (issue #1181, D21):
   * `TripCrewLine` above renders the crew who switched
   * `crew_public_consent_at` on for themselves, and nobody else. This line is
   * unchanged by it — a shop whose staff have consented to nothing still says
   * what languages are aboard.
   */
  crewLanguages: string | null;
  locale: string;
}) {
  const t = diverTranslator(locale);
  // Stored metric, displayed in the shop's own units (src/lib/depth-units.ts,
  // src/lib/temperature-units.ts): a Florida shop set to feet was still being
  // shown "24°C" and "12 m" on its own diver-facing trip page. The two units
  // are independent settings — a shop can publish feet and Celsius.
  const depthUnit = shop.depthUnit;
  const temperatureUnit = temperatureUnitFor(shop);
  const hasForecast = crewPrediction || Boolean(automatedForecast);
  const waterTemperatureC = !hasForecast
    ? null
    : crewPrediction
      ? trip.waterTemperatureC
      : (automatedForecast?.waterTemperatureC ?? null);
  // Two different things share this line.
  //
  // The crew's own read is free text they typed ("choppy after lunch") and is
  // shown exactly as written — never translated, never re-unitted.
  //
  // The automated outlook is a band rather than the model's raw numbers:
  // significant wave height is a statistic about the highest third of waves and
  // a bearing answers a question nobody on a booking page asked.
  // `seaStateReading` (src/lib/marine-forecast.ts) does the comparing and the
  // words come from the bundle.
  const seaState = crewPrediction ? null : seaStateReading(automatedForecast?.surface ?? null);
  const windState = crewPrediction ? null : windReading(automatedForecast?.wind ?? null);
  const wind = windState ? windText(t, windState) : null;
  const surfaceText = crewPrediction
    ? trip.surfaceConditions
    : (seaState ? seaStateText(t, seaState) : null)?.label;
  // Only the crew ever records underwater visibility — the marine model has no
  // such reading (see `AutomatedMarineForecast`).
  const visibilityMeters = crewPrediction ? trip.visibilityMeters : null;

  const parts = [
    waterTemperatureC !== null
      ? t("trip.conditionsWater", {
          value: temperatureText(t, waterTemperatureC, temperatureUnit),
        })
      : null,
    visibilityMeters !== null
      ? t("trip.conditionsVisibility", { value: depthText(t, visibilityMeters, depthUnit) })
      : null,
    surfaceText ?? null,
    wind?.label ?? null,
    crewLanguages ? t("trip.conditionsLanguages", { languages: crewLanguages }) : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;

  return (
    <section className="mt-6 border-t border-border pt-4">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
        {parts.map((part, index) => (
          // The separator is a sibling of the part, never a child of it: a
          // reading nested beside a dot is one string to anything reading the
          // DOM, which is how "Light chop" becomes "·Light chop".
          <Fragment key={part}>
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span>{part}</span>
          </Fragment>
        ))}
      </p>
      {crewPrediction && trip.conditionsSummary ? (
        <p className="mt-2 text-sm text-muted">{trip.conditionsSummary}</p>
      ) : null}
      {crewPrediction ? (
        <p className="mt-2 text-xs text-muted">
          {t("trip.forecastCrewNote")}{" "}
          {trip.conditionsUpdatedAt
            ? t("trip.forecastUpdated", {
                // `formatDateTimeTz`, not a bare `toLocaleString`: that one's
                // default field set carries **seconds**, so this line read
                // "Updated 8/22/2026, 10:33:06 AM EDT" to a diver deciding what
                // to pack (issue #799).
                when: formatDateTimeTz(trip.conditionsUpdatedAt, locale, shop.timezone),
              })
            : t("trip.forecastUpdateUnavailable")}
        </p>
      ) : automatedForecast ? (
        // The credit stays a link — Open-Meteo's license requires attribution
        // *with* a link back, not the name in plain text — and beside it the one
        // thing nothing else on the page says: the crew make the final call.
        <p className="mt-2 text-xs text-muted">
          {t("trip.forecastCrewCall")} {t("trip.forecastCreditPrefix")}{" "}
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Open-Meteo
          </a>
        </p>
      ) : null}
    </section>
  );
}
