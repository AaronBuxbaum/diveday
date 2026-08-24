import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATED_FORECAST_WINDOW_DAYS,
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  isHighWind,
  seaStateReading,
  shouldShowAutomatedForecast,
  windReading,
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
  it("skips live provider traffic when external HTTP is disabled", async () => {
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const fetcher = vi.spyOn(globalThis, "fetch");

    await expect(
      fetchAutomatedMarineForecast(
        { latitude: 25.12, longitude: -80.3 },
        new Date("2026-07-20T09:00:00Z"),
      ),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("selects the forecast hour closest to departure and returns conditions as numbers and codes", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("marine-api.open-meteo.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hourly: {
                time: [1_784_419_200, 1_784_422_800, 1_784_426_400],
                sea_surface_temperature: [26.2, 26.8, 27.1],
                wave_height: [0.4, 0.7, 0.9],
                wave_period: [5, 7, 8],
                wave_direction: [80, 92, 105],
                ocean_current_velocity: [1.2, 1.8, 2.0],
                ocean_current_direction: [180, 190, 200],
              },
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            hourly: {
              time: [1_784_419_200, 1_784_422_800, 1_784_426_400],
              wind_speed_10m: [12, 18, 20],
              wind_gusts_10m: [16, 24, 28],
              wind_direction_10m: [85, 90, 95],
            },
            daily: {
              time: [1_784_422_800],
              sunrise: [1_784_400_000],
              sunset: [1_784_450_000],
            },
          }),
        ),
      );
    });

    const forecast = await fetchAutomatedMarineForecast(
      { latitude: 25.12, longitude: -80.3 },
      new Date(1_784_422_900_000),
      fetcher,
    );

    expect(forecast).toEqual({
      waterTemperatureC: 27,
      surface: { waveHeightMeters: 0.7, waveDirection: "e", wavePeriodSeconds: 7 },
      wind: { speedKnots: 18, gustsKnots: 24, direction: "e" },
      current: { velocityKnots: 1, direction: "s" },
      sun: { sunrise: new Date(1_784_400_000_000), sunset: new Date(1_784_450_000_000) },
      source: "Open-Meteo marine forecast",
      validAt: new Date(1_784_422_800_000),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the sea state and wind when partial fields are published", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("marine-api.open-meteo.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hourly: {
                time: [1_784_422_800],
                sea_surface_temperature: [null],
                wave_height: [1.2],
                wave_period: [null],
                wave_direction: [-10],
              },
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            hourly: {
              time: [1_784_422_800],
              wind_speed_10m: [15],
              wind_gusts_10m: [null],
              wind_direction_10m: [45],
            },
          }),
        ),
      );
    });

    const forecast = await fetchAutomatedMarineForecast(
      { latitude: 25.12, longitude: -80.3 },
      new Date(1_784_422_800_000),
      fetcher,
    );

    expect(forecast?.surface).toEqual({
      waveHeightMeters: 1.2,
      waveDirection: "n",
      wavePeriodSeconds: null,
    });
    expect(forecast?.wind).toEqual({
      speedKnots: 15,
      gustsKnots: null,
      direction: "ne",
    });
    expect(forecast?.waterTemperatureC).toBeNull();
  });

  it("returns null when both providers fail", async () => {
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

describe("seaStateReading", () => {
  const sea = (waveHeightMeters: number, wavePeriodSeconds: number | null = 7) => ({
    waveHeightMeters,
    waveDirection: "e" as const,
    wavePeriodSeconds,
  });

  it("has nothing to read when the model gave no sea", () => {
    expect(seaStateReading(null)).toBeNull();
  });

  it("bands by height, finely where a dive day is actually decided", () => {
    expect(seaStateReading(sea(0.05))).toBe("glassy");
    expect(seaStateReading(sea(0.3))).toBe("calm");
    expect(seaStateReading(sea(0.7))).toBe("light_chop");
    expect(seaStateReading(sea(1.2))).toBe("choppy");
    expect(seaStateReading(sea(2.0))).toBe("rough");
    expect(seaStateReading(sea(4.0))).toBe("very_rough");
  });

  it("reads the same height differently by period", () => {
    expect(seaStateReading(sea(1.0, 4))).toBe("rough");
    expect(seaStateReading(sea(1.0, 7))).toBe("choppy");
    expect(seaStateReading(sea(1.0, 12))).toBe("light_chop");
  });

  it("never calls a long-period swell glassy, however small", () => {
    expect(seaStateReading(sea(0.05, 14))).toBe("calm");
    expect(seaStateReading(sea(0.3, 14))).toBe("calm");
  });

  it("takes the height alone when the model reported no period", () => {
    expect(seaStateReading(sea(1.0, null))).toBe("choppy");
  });

  it("never runs off either end of the scale", () => {
    expect(seaStateReading(sea(0, 2))).toBe("calm");
    expect(seaStateReading(sea(99, 2))).toBe("very_rough");
  });
});

describe("windReading", () => {
  it("returns null when no wind is provided", () => {
    expect(windReading(null)).toBeNull();
  });

  it("classifies wind speed into recreational bands", () => {
    expect(windReading({ speedKnots: 4, gustsKnots: null, direction: "e" })).toBe("calm_wind");
    expect(windReading({ speedKnots: 10, gustsKnots: 14, direction: "e" })).toBe("light_breeze");
    expect(windReading({ speedKnots: 18, gustsKnots: 22, direction: "e" })).toBe("breezy");
    expect(windReading({ speedKnots: 24, gustsKnots: 28, direction: "e" })).toBe("windy");
    expect(windReading({ speedKnots: 32, gustsKnots: 40, direction: "e" })).toBe("gale_warning");
  });
});

describe("isHighWind", () => {
  it("returns false for calm to moderate wind", () => {
    expect(isHighWind(null)).toBe(false);
    expect(isHighWind({ speedKnots: 15, gustsKnots: 20, direction: "e" })).toBe(false);
  });

  it("returns true when sustained wind is at or above threshold", () => {
    expect(isHighWind({ speedKnots: 22, gustsKnots: null, direction: "e" })).toBe(true);
  });

  it("returns true when gusts are high even if sustained is below threshold", () => {
    expect(isHighWind({ speedKnots: 18, gustsKnots: 27, direction: "e" })).toBe(true);
  });
});
