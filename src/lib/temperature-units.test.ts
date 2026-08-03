import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  MAX_ENTERED_TEMPERATURE_C,
  MIN_ENTERED_TEMPERATURE_C,
  maxEnteredTemperature,
  minEnteredTemperature,
  temperatureInUnit,
  temperatureToCelsius,
  temperatureUnitFor,
} from "./temperature-units";

describe("temperatureUnitFor", () => {
  it("reads the shop's own stored setting", () => {
    expect(temperatureUnitFor({ temperatureUnit: "fahrenheit" })).toBe("fahrenheit");
    expect(temperatureUnitFor({ temperatureUnit: "celsius" })).toBe("celsius");
  });

  it("defaults to Celsius for a projection that does not carry the column", () => {
    expect(temperatureUnitFor({})).toBe("celsius");
    expect(temperatureUnitFor({ temperatureUnit: null })).toBe("celsius");
    expect(temperatureUnitFor(null)).toBe("celsius");
    expect(temperatureUnitFor(undefined)).toBe("celsius");
  });

  it("no longer follows the depth unit — feet and Celsius is a shop we support", () => {
    // The whole point of the column: a Caribbean operator serving American
    // divers publishes depths in feet and water temperature in Celsius, which
    // the old `depth_unit` derivation could not express.
    expect(temperatureUnitFor({ temperatureUnit: "celsius" })).toBe("celsius");
  });
});

describe("celsiusToFahrenheit / fahrenheitToCelsius", () => {
  it("converts the fixed points exactly", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
  });

  it("round-trips without drift", () => {
    for (const celsius of [-2, 4, 18, 24, 29]) {
      expect(fahrenheitToCelsius(celsiusToFahrenheit(celsius))).toBeCloseTo(celsius, 10);
    }
  });
});

describe("temperatureInUnit", () => {
  it("passes Celsius straight through, rounded to a whole degree", () => {
    expect(temperatureInUnit(24, "celsius")).toBe(24);
    expect(temperatureInUnit(23.6, "celsius")).toBe(24);
  });

  it("converts to whole Fahrenheit", () => {
    expect(temperatureInUnit(24, "fahrenheit")).toBe(75);
    expect(temperatureInUnit(18, "fahrenheit")).toBe(64);
  });

  it("handles a genuinely cold quarry without a sign error", () => {
    expect(temperatureInUnit(-1, "fahrenheit")).toBe(30);
  });
});

describe("temperatureToCelsius", () => {
  it("passes a Celsius entry straight through", () => {
    expect(temperatureToCelsius(24, "celsius")).toBe(24);
  });

  it("converts a Fahrenheit entry to the Celsius that gets stored", () => {
    expect(temperatureToCelsius(76, "fahrenheit")).toBeCloseTo(24.444, 3);
    expect(temperatureToCelsius(32, "fahrenheit")).toBe(0);
  });

  it("round-trips every whole Fahrenheit degree a crew can enter", () => {
    // The reason `trips.water_temperature_c` is floating point: as an integer,
    // 76°F stored as 24 and read back as 75.
    for (
      let entered = minEnteredTemperature("fahrenheit");
      entered <= maxEnteredTemperature("fahrenheit");
      entered += 1
    ) {
      expect(temperatureInUnit(temperatureToCelsius(entered, "fahrenheit"), "fahrenheit")).toBe(
        entered,
      );
    }
  });
});

describe("minEnteredTemperature / maxEnteredTemperature", () => {
  it("is the canonical Celsius range for a Celsius shop", () => {
    expect(minEnteredTemperature("celsius")).toBe(MIN_ENTERED_TEMPERATURE_C);
    expect(maxEnteredTemperature("celsius")).toBe(MAX_ENTERED_TEMPERATURE_C);
  });

  it("rounds inward for Fahrenheit so the offered bound is never refused", () => {
    // -2°C is 28.4°F: rounded to nearest, the form would offer 28, which
    // converts back to -2.2°C and the Celsius bound then rejects it.
    expect(minEnteredTemperature("fahrenheit")).toBe(29);
    expect(maxEnteredTemperature("fahrenheit")).toBe(104);
    expect(temperatureToCelsius(minEnteredTemperature("fahrenheit"), "fahrenheit")).toBeGreaterThan(
      MIN_ENTERED_TEMPERATURE_C,
    );
    expect(
      temperatureToCelsius(maxEnteredTemperature("fahrenheit"), "fahrenheit"),
    ).toBeLessThanOrEqual(MAX_ENTERED_TEMPERATURE_C);
  });
});
