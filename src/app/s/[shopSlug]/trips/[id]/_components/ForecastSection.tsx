import type { DiverMessageKey } from "@/i18n/messages";
import { diverTranslator } from "@/i18n/messages";
import { depthText, seaStateText, temperatureText } from "@/i18n/unit-labels";
import { type ExposureSuit, exposureSuitFor } from "@/lib/diver-planning";
import { seaStateReading } from "@/lib/marine-forecast";
import { temperatureUnitFor } from "@/lib/temperature-units";
import type { AutomatedForecast, Shop, Trip } from "./types";

/**
 * `exposureSuitFor` returns a band code (src/lib/diver-planning.ts); this is
 * where each one becomes the sentence under the reading. Thicknesses are
 * written in millimetres in every locale because that is how neoprene is sold
 * everywhere, including the markets that read feet and Fahrenheit.
 */
const EXPOSURE_SUIT_KEYS: Record<ExposureSuit, DiverMessageKey> = {
  swimwear: "trip.exposureSuit.swimwear",
  shorty: "trip.exposureSuit.shorty",
  wetsuit5mm: "trip.exposureSuit.wetsuit5mm",
  wetsuit7mm: "trip.exposureSuit.wetsuit7mm",
  drysuit: "trip.exposureSuit.drysuit",
};

export function ForecastSection({
  shop,
  trip,
  crewPrediction,
  automatedForecast,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  crewPrediction: boolean;
  automatedForecast: AutomatedForecast;
  locale: string;
}) {
  if (!crewPrediction && !automatedForecast) return null;
  const t = diverTranslator(locale);
  // Stored metric, displayed in the shop's own units (src/lib/depth-units.ts,
  // src/lib/temperature-units.ts): a Florida shop set to feet was still being
  // shown "24°C" and "12 m" on its own diver-facing trip page. The two units
  // are independent settings — a shop can publish feet and Celsius.
  const depthUnit = shop.depthUnit;
  const temperatureUnit = temperatureUnitFor(shop);
  const waterTemperatureC = crewPrediction
    ? trip.waterTemperatureC
    : (automatedForecast?.waterTemperatureC ?? null);
  // Two different things share this row.
  //
  // The crew's own read is free text they typed ("choppy after lunch") and is
  // shown exactly as written — never translated, never re-unitted.
  //
  // The automated outlook used to be the model's numbers written out: "0.7 m
  // seas from E · 7 s period". True, and close to useless to the person
  // deciding whether to bring a seasickness tablet — significant wave height is
  // a statistic about the highest third of waves, a bearing answers a question
  // nobody on a booking page asked, and a period means nothing without
  // something to compare it to. `seaStateReading` (src/lib/marine-forecast.ts)
  // does that comparing and returns a band; the words come from the bundle.
  const seaState = crewPrediction ? null : seaStateReading(automatedForecast?.surface ?? null);
  const sea = seaState ? seaStateText(t, seaState) : null;
  const surfaceText = crewPrediction ? trip.surfaceConditions : (sea?.label ?? null);
  // Only the crew ever records underwater visibility — the marine model has no
  // such reading (see `AutomatedMarineForecast`).
  const visibilityMeters = crewPrediction ? trip.visibilityMeters : null;
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">
        {crewPrediction ? t("trip.crewPrediction") : t("trip.automatedOutlook")}
      </p>
      {crewPrediction && trip.conditionsSummary ? (
        <p className="mt-3 text-muted">{trip.conditionsSummary}</p>
      ) : null}
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        {waterTemperatureC !== null ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">{t("trip.waterTemperature")}</dt>
            <dd className="mt-1 text-lg font-semibold">
              {temperatureText(t, waterTemperatureC, temperatureUnit)}
            </dd>
            {/* What the number means for what to wear — the same shape the sea
                state wears below, and for the same reason. A temperature is a
                figure a diver has to translate before it is any use, and the
                translation ("most divers want a 5 mm here") is the only reason
                they opened the card. Advisory, and worded as such: thermal
                comfort is personal, and the crew's own note above outranks a
                rule of thumb. */}
            <dd className="mt-1 text-sm text-muted">
              {t(EXPOSURE_SUIT_KEYS[exposureSuitFor(waterTemperatureC)])}
            </dd>
          </div>
        ) : null}
        {visibilityMeters !== null ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">{t("trip.visibility")}</dt>
            <dd className="mt-1 text-lg font-semibold">
              {depthText(t, visibilityMeters, depthUnit)}
            </dd>
          </div>
        ) : null}
        {surfaceText ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">{t("trip.surface")}</dt>
            <dd className="mt-1 text-lg font-semibold">{surfaceText}</dd>
            {/* What the band means for the day, on the automated path only —
                a crew who typed "choppy after lunch" have already said it in
                their own words, and a second sentence underneath explaining
                theirs back to them would be the app talking over the boat. */}
            {sea ? <dd className="mt-1 text-sm text-muted">{sea.detail}</dd> : null}
          </div>
        ) : null}
      </dl>
      {crewPrediction ? (
        <p className="mt-4 text-xs text-muted">
          {t("trip.forecastCrewNote")}{" "}
          {trip.conditionsUpdatedAt
            ? t("trip.forecastUpdated", {
                when: trip.conditionsUpdatedAt.toLocaleString(locale, {
                  timeZone: shop.timezone,
                  timeZoneName: "short",
                }),
              })
            : t("trip.forecastUpdateUnavailable")}
        </p>
      ) : automatedForecast ? (
        // One line of fine print, not a 16px paragraph above it. "Planning
        // outlook from Open-Meteo" restated the eyebrow this card already
        // wears ("Automated marine outlook") at nearly body weight, so the
        // first thing a diver read under the numbers was where they came from
        // rather than what they mean. What survives is what nothing else says:
        // that the crew makes the final call, and who supplied the model. The
        // credit stays a link — Open-Meteo's license (open-meteo.com/en/license)
        // requires attribution *with* a link back, not the name in plain text.
        //
        // No "valid for <date> · <time>" any more. It was an hour stamp on a
        // planning outlook for a departure whose own time is at the top of this
        // page, and a diver reading it a day out has nothing to do with the
        // difference. The freshness that matters is stated instead: the crew
        // confirm at the dock.
        <p className="mt-4 text-xs text-muted">
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
