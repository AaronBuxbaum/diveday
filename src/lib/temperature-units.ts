/**
 * Water temperature is stored in Celsius everywhere (`trips.water_temperature_c`,
 * the marine-forecast adapter, the packing tip's cold/mild threshold), exactly
 * the way depth is stored in metres. A shop's `temperature_unit` changes only
 * how a reading is *typed in and read back*, never what is on disk, so
 * switching a shop from Celsius to Fahrenheit reinterprets no existing row.
 *
 * This used to be derived from `depth_unit` (feet ⇒ Fahrenheit) because there
 * was no column to read. There is one now, and the two settings genuinely come
 * apart: a Caribbean operator serving American divers publishes feet and
 * Celsius, and the derivation had no way to say so. The migration that added
 * the column backfilled Fahrenheit for every shop already on feet, so nothing
 * a shop was reading changed underneath it.
 *
 * Framework-free and word-free: returns numbers and unit codes, and the message
 * bundle turns them into "24°C" or "75°F" (AGENTS.md — src/lib returns codes,
 * not sentences).
 */

/** How a shop reads temperature. Mirrors the `temperature_unit` pg enum. */
export type TemperatureUnit = "celsius" | "fahrenheit";

/**
 * The unit a shop reads water temperature in: its own stored setting, with
 * Celsius as the fallback for a projection that does not carry the column (and
 * for the column's own default). One function so every surface — trip page,
 * recap, packing tip, night-before brief — resolves it the same way instead of
 * each reaching for the row and each choosing its own fallback.
 */
export function temperatureUnitFor(
  shop: { temperatureUnit?: TemperatureUnit | null } | null | undefined,
): TemperatureUnit {
  return shop?.temperatureUnit ?? "celsius";
}

export function celsiusToFahrenheit(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * (5 / 9);
}

/**
 * A stored Celsius reading in the shop's unit, rounded to a whole degree for
 * display. Whole degrees on purpose: a water temperature is a "bring a
 * 5 mm" figure, and "23.9°C" implies a precision the reading does not have.
 *
 * Round-trips exactly for a shop working in Fahrenheit — 76°F stores as
 * 24.44°C and reads back as 76 — which is why the column is floating-point.
 */
export function temperatureInUnit(celsius: number, unit: TemperatureUnit): number {
  return Math.round(unit === "fahrenheit" ? celsiusToFahrenheit(celsius) : celsius);
}

/** A temperature typed in the shop's unit, converted to the Celsius actually stored. */
export function temperatureToCelsius(value: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? fahrenheitToCelsius(value) : value;
}

/**
 * The range the conditions form accepts, in canonical Celsius. A typo guard,
 * not a claim about diveable water: -2°C is under an ice cap and 40°C is a hot
 * spring, so anything a crew could legitimately record fits, while a
 * Fahrenheit number pasted into a Celsius shop's box does not.
 */
export const MIN_ENTERED_TEMPERATURE_C = -2;
export const MAX_ENTERED_TEMPERATURE_C = 40;

/**
 * The same bounds in the shop's own unit, for the entry form's min/max and for
 * the server to re-check against. Rounded *inward* (ceil the floor, floor the
 * ceiling), never to nearest: -2°C is 28.4°F, and a min of 28 would offer the
 * crew a value the Celsius bound then refuses.
 */
export function minEnteredTemperature(unit: TemperatureUnit): number {
  return unit === "fahrenheit"
    ? Math.ceil(celsiusToFahrenheit(MIN_ENTERED_TEMPERATURE_C))
    : MIN_ENTERED_TEMPERATURE_C;
}

export function maxEnteredTemperature(unit: TemperatureUnit): number {
  return unit === "fahrenheit"
    ? Math.floor(celsiusToFahrenheit(MAX_ENTERED_TEMPERATURE_C))
    : MAX_ENTERED_TEMPERATURE_C;
}
