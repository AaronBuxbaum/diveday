import { formatShortDate } from "@/lib/format";
import type { AutomatedForecast, Shop, Trip } from "./types";

export function ForecastSection({
  shop,
  trip,
  crewPrediction,
  automatedForecast,
}: {
  shop: Shop;
  trip: Trip;
  crewPrediction: boolean;
  automatedForecast: AutomatedForecast;
}) {
  if (!crewPrediction && !automatedForecast) return null;
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">
        {crewPrediction ? "Crew prediction" : "Automated marine outlook"}
      </p>
      {crewPrediction && trip.conditionsSummary ? (
        <p className="mt-3 text-muted">{trip.conditionsSummary}</p>
      ) : null}
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        {(crewPrediction ? trip.waterTemperatureC : automatedForecast?.waterTemperatureC) !==
        null ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">Water temperature</dt>
            <dd className="mt-1 text-lg font-semibold">
              {crewPrediction ? trip.waterTemperatureC : automatedForecast?.waterTemperatureC}°C
            </dd>
          </div>
        ) : null}
        {crewPrediction && trip.visibilityMeters !== null ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">Visibility</dt>
            <dd className="mt-1 text-lg font-semibold">{trip.visibilityMeters} m</dd>
          </div>
        ) : null}
        {(crewPrediction ? trip.surfaceConditions : automatedForecast?.surfaceConditions) ? (
          <div className="rounded-lg bg-surface-sunken p-3">
            <dt className="text-sm text-muted">Surface</dt>
            <dd className="mt-1 text-lg font-semibold">
              {crewPrediction ? trip.surfaceConditions : automatedForecast?.surfaceConditions}
            </dd>
          </div>
        ) : null}
      </dl>
      {crewPrediction ? (
        <p className="mt-4 text-xs text-muted">
          Forecast supplied by the crew; conditions can change. The final call happens at the dock.
          {trip.conditionsUpdatedAt
            ? ` Updated ${trip.conditionsUpdatedAt.toLocaleString("en-US", { timeZone: shop.timezone, timeZoneName: "short" })}.`
            : " Update time unavailable."}
        </p>
      ) : automatedForecast ? (
        <div className="mt-4">
          <p className="text-base text-muted">
            Planning outlook from Open-Meteo — the crew confirms conditions and makes the final call
            at the dock.
          </p>
          <p className="mt-2 text-xs text-muted">
            Underwater visibility comes from the crew.{" "}
            <time dateTime={automatedForecast.validAt.toISOString()}>
              For {formatShortDate(automatedForecast.validAt, "en-US", shop.timezone)} ·{" "}
              {automatedForecast.validAt.toLocaleTimeString("en-US", {
                timeZone: shop.timezone,
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </time>
          </p>
        </div>
      ) : null}
    </section>
  );
}
