import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "../_components/types";

const outlook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/marine-forecast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/marine-forecast")>()),
  automatedForecastForDeparture: outlook,
}));

const { publicForecast } = await import("./public-forecast");

const site = { forecastLatitude: 25, forecastLongitude: -80 };
const tripWith = (read: Partial<Trip>) =>
  ({
    conditionsSummary: null,
    waterTemperatureC: null,
    visibilityMeters: null,
    surfaceConditions: null,
    diveSite: site,
    startsAt: new Date("2026-11-01T13:00:00Z"),
    ...read,
  }) as unknown as Trip;

beforeEach(() => {
  outlook.mockReset();
  outlook.mockResolvedValue({ waterTemperatureC: 26 });
});

describe("publicForecast", () => {
  it("shows the crew's read and asks for no outlook when the crew wrote one", async () => {
    const forecast = publicForecast(
      { publicConditionsEnabled: true },
      tripWith({ conditionsSummary: "Flat calm" }),
    );
    expect(forecast.crewPrediction).toBe(true);
    expect(await forecast.automatedForecast).toBeNull();
    expect(outlook).not.toHaveBeenCalled();
  });

  it("asks for the outlook when the crew wrote nothing", async () => {
    const forecast = publicForecast({ publicConditionsEnabled: true }, tripWith({}));
    expect(forecast.crewPrediction).toBe(false);
    expect(await forecast.automatedForecast).toEqual({ waterTemperatureC: 26 });
  });

  it("says nothing about the weather while public conditions are off", async () => {
    const forecast = publicForecast(
      { publicConditionsEnabled: false },
      tripWith({ conditionsSummary: "Flat calm", waterTemperatureC: 27 }),
    );
    expect(forecast.crewPrediction).toBe(false);
    expect(await forecast.automatedForecast).toBeNull();
    expect(outlook).not.toHaveBeenCalled();
  });
});
