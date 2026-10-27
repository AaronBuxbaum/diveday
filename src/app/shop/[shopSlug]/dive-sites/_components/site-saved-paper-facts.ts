import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import { stationDistanceInUnit, stationLabel, type TideStationEcho } from "@/lib/tide-stations";
import type { SiteFieldValues } from "./SiteFields";

export function savedForecastLines(
  values: Pick<
    SiteFieldValues,
    | "forecastLatitude"
    | "forecastLongitude"
    | "tideStationId"
    | "tideStationConfirmed"
    | "tidePreference"
  >,
  station: TideStationEcho | null | undefined,
  unit: DepthUnit,
  t: StaffTranslator,
) {
  const lines: string[] = [];
  if (values.forecastLatitude !== null && values.forecastLongitude !== null)
    lines.push(`${values.forecastLatitude}, ${values.forecastLongitude}`);
  if (values.tideStationId)
    lines.push(`${t("diveSites.form.tideStationLabel")}: ${values.tideStationId}`);
  if (station)
    lines.push(
      t("diveSites.form.tideStationEcho", { id: station.id, name: stationLabel(station) }),
    );
  if (station?.far && station.distanceKm !== null) {
    if (!values.tideStationConfirmed)
      lines.push(
        t(
          unit === "feet"
            ? "diveSites.form.tideStationFarMiles"
            : "diveSites.form.tideStationFarKm",
          { distance: stationDistanceInUnit(station.distanceKm, unit) },
        ),
      );
  }
  if (values.tideStationConfirmed) lines.push(t("diveSites.form.tideStationConfirmedCheckbox"));
  else if (station?.far) lines.push(t("diveSites.form.tideStationUnconfirmed"));
  lines.push(
    `${t("diveSites.form.tidePreferenceLabel")}: ${t(`diveSites.form.tidePreference.${values.tidePreference}`)}`,
  );
  return lines;
}

export function savedFitLines(
  values: Pick<SiteFieldValues, "fitTone" | "fitNote">,
  t: StaffTranslator,
) {
  const label =
    values.fitTone === "welcoming"
      ? t("diveSites.form.fitToneWelcoming")
      : values.fitTone === "demanding"
        ? t("diveSites.form.fitToneDemanding")
        : values.fitTone === "unknown"
          ? t("diveSites.form.fitToneAskCrew")
          : null;
  return [label, values.fitNote];
}
