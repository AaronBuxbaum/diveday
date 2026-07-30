import { diverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";
import type { AutomatedForecast, Shop, Trip } from "./types";

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
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">
        {crewPrediction ? t("trip.crewPrediction") : t("trip.automatedOutlook")}
      </p>
      {crewPrediction && trip.conditionsSummary ? (
        <p className="mt-3 text-muted">{trip.conditionsSummary}</p>
      ) : null}
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        {(crewPrediction ? trip.waterTemperatureC : automatedForecast?.waterTemperatureC) !==
        null ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">{t("trip.waterTemperature")}</dt>
            <dd className="mt-1 text-lg font-semibold">
              {crewPrediction ? trip.waterTemperatureC : automatedForecast?.waterTemperatureC}°C
            </dd>
          </div>
        ) : null}
        {crewPrediction && trip.visibilityMeters !== null ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">{t("trip.visibility")}</dt>
            <dd className="mt-1 text-lg font-semibold">{trip.visibilityMeters} m</dd>
          </div>
        ) : null}
        {(crewPrediction ? trip.surfaceConditions : automatedForecast?.surfaceConditions) ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">{t("trip.surface")}</dt>
            <dd className="mt-1 text-lg font-semibold">
              {crewPrediction ? trip.surfaceConditions : automatedForecast?.surfaceConditions}
            </dd>
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
        <div className="mt-4">
          {/* Open-Meteo's license (open-meteo.com/en/license) requires attribution
              with a link back to them, not just the name in plain text. */}
          <p className="text-base text-muted">
            {t("trip.forecastSourcePrefix")}{" "}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Open-Meteo
            </a>{" "}
            {t("trip.forecastSourceSuffix")}
          </p>
          <p className="mt-2 text-xs text-muted">
            {t("trip.forecastVisibilityNote")}{" "}
            <time dateTime={automatedForecast.validAt.toISOString()}>
              {t("trip.forecastValidFor", {
                date: formatShortDate(automatedForecast.validAt, locale, shop.timezone),
                time: automatedForecast.validAt.toLocaleTimeString(locale, {
                  timeZone: shop.timezone,
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                }),
              })}
            </time>
          </p>
        </div>
      ) : null}
    </section>
  );
}
