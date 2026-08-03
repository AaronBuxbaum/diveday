import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  temperatureInUnit,
  temperatureUnitFor,
} from "./temperature-units";

describe("temperatureUnitFor", () => {
  it("reads Fahrenheit for a shop that works in feet", () => {
    expect(temperatureUnitFor("feet")).toBe("fahrenheit");
  });

  it("reads Celsius for a shop that works in metres", () => {
    expect(temperatureUnitFor("meters")).toBe("celsius");
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
