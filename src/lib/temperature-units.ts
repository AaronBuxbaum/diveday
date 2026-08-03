import type { DepthUnit } from "./depth-units";

/**
 * Water temperature is stored in Celsius everywhere (`trips.water_temperature_c`,
 * the marine-forecast adapter, the packing tip's cold/mild threshold), exactly
 * the way depth is stored in metres. This module only decides how a stored
 * reading is *read back*; nothing on disk ever moves.
 *
 * There is no `temperature_unit` column, and this deliberately does not invent
 * one: a shop's existing `depth_unit` already states which measurement system
 * it works in, so a shop reading depths in feet reads water temperature in
 * Fahrenheit. If a shop ever needs to split the two (feet with Celsius), that
 * is a schema change and a settings control, not a guess made here.
 *
 * Framework-free and word-free: returns numbers and unit codes, and the message
 * bundle turns them into "24°C" or "75°F" (AGENTS.md — src/lib returns codes,
 * not sentences).
 */

/** How a shop reads temperature. Derived from `depth_unit`, never stored on its own. */
export type TemperatureUnit = "celsius" | "fahrenheit";

export function temperatureUnitFor(depthUnit: DepthUnit): TemperatureUnit {
  return depthUnit === "feet" ? "fahrenheit" : "celsius";
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
 */
export function temperatureInUnit(celsius: number, unit: TemperatureUnit): number {
  return Math.round(unit === "fahrenheit" ? celsiusToFahrenheit(celsius) : celsius);
}
