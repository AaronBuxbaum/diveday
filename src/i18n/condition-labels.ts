import type { DepthUnit } from "@/lib/depth-units";
import type { TemperatureUnit } from "@/lib/temperature-units";
import type { DiverTranslator } from "./messages";
import type { ReaderUnits } from "./reader-units";
import { depthText, temperatureText } from "./unit-labels";

/** The same water, visibility and surface readings on a departure and its schedule row. */
export function conditionReadings(
  t: DiverTranslator,
  readings: {
    waterTemperatureC: number | null;
    visibilityMeters: number | null;
    surfaceText: string | null;
  },
  units: { depth: DepthUnit; temperature: TemperatureUnit; reader?: ReaderUnits },
): string[] {
  return [
    readings.waterTemperatureC !== null
      ? t("trip.conditionsWater", {
          value: temperatureText(
            t,
            readings.waterTemperatureC,
            units.temperature,
            units.reader?.temperature,
          ),
        })
      : null,
    readings.visibilityMeters !== null
      ? t("trip.conditionsVisibility", {
          value: depthText(t, readings.visibilityMeters, units.depth, units.reader?.depth),
        })
      : null,
    readings.surfaceText,
  ].filter((part): part is string => Boolean(part));
}
