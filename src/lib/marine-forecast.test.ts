import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATED_FORECAST_WINDOW_DAYS,
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  shouldShowAutomatedForecast,
} from "./marine-forecast";

describe("shouldShowAutomatedForecast", () => {
  const now = new Date("2026-07-18T12:00:00Z");

  it("shows only for future trips inside the forecast window", () => {
    expect(shouldShowAutomatedForecast(new Date("2026-07-18T12:01:00Z"), now)).toBe(true);
    expect(
      shouldShowAutomatedForecast(
        new Date(now.getTime() + AUTOMATED_FORECAST_WINDOW_DAYS * 86_400_000),
        now,
      ),
    ).toBe(true);
  });

  it("hides past trips and trips beyond the source window", () => {
    expect(shouldShowAutomatedForecast(new Date("2026-07-18T12:00:00Z"), now)).toBe(false);
    expect(
      shouldShowAutomatedForecast(
        new Date(now.getTime() + (AUTOMATED_FORECAST_WINDOW_DAYS + 1) * 86_400_000),
        now,
      ),
    ).toBe(false);
  });
});

describe("fetchAutomatedMarineForecast", () => {
  it("selects the forecast hour closest to departure and writes a dive-friendly sea-state note", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hourly: {
            time: [1_784_419_200, 1_784_422_800, 1_784_426_400],
            sea_surface_temperature: [26.2, 26.8, 27.1],
            wave_height: [0.4, 0.7, 0.9],
            wave_period: [5, 7, 8],
            wave_direction: [80, 92, 105],
          },
        }),
      ),
    );

    const forecast = await fetchAutomatedMarineForecast(
      { latitude: 25.12, longitude: -80.3 },
      new Date(1_784_422_900_000),
      fetcher,
    );

    expect(forecast).toEqual({
      waterTemperatureC: 27,
      surfaceConditions: "0.7 m waves from E · 7 s period",
      source: "Open-Meteo marine forecast",
      validAt: new Date(1_784_422_800_000),
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("sea_surface_temperature");
  });

  it("returns no briefing when the provider is unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      fetchAutomatedMarineForecast(
        { latitude: 25.12, longitude: -80.3 },
        new Date("2026-07-20T09:00:00Z"),
        fetcher,
      ),
    ).resolves.toBeNull();
  });
});

describe("hasCrewPrediction", () => {
  it("keeps an empty staff form on the automated fallback", () => {
    expect(
      hasCrewPrediction({
        conditionsSummary: null,
        waterTemperatureC: null,
        visibilityMeters: null,
        surfaceConditions: null,
      }),
    ).toBe(false);
    expect(
      hasCrewPrediction({
        conditionsSummary: null,
        waterTemperatureC: null,
        visibilityMeters: 12,
        surfaceConditions: null,
      }),
    ).toBe(true);
  });
});
