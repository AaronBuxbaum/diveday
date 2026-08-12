import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATED_FORECAST_WINDOW_DAYS,
  fetchAutomatedMarineForecast,
  hasCrewPrediction,
  seaStateReading,
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

  it("selects the forecast hour closest to departure and returns the sea state as numbers and codes", async () => {
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

    // Metres and a compass code, never "0.7 m waves from E" — the shop's
    // `depth_unit` decides whether a crew reads metres or feet, and the
    // reader's language decides whether the bearing is E or O (DOM-L2).
    expect(forecast).toEqual({
      waterTemperatureC: 27,
      surface: { waveHeightMeters: 0.7, waveDirection: "e", wavePeriodSeconds: 7 },
      source: "Open-Meteo marine forecast",
      validAt: new Date(1_784_422_800_000),
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("sea_surface_temperature");
  });

  it("keeps the sea state when only the wave height is published", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hourly: {
            time: [1_784_422_800],
            sea_surface_temperature: [null],
            wave_height: [1.2],
            wave_period: [null],
            // A bearing the provider has been seen to return below zero rather
            // than wrapping into [0, 360): −10° is still north, not a crash.
            wave_direction: [-10],
          },
        }),
      ),
    );

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
    expect(forecast?.waterTemperatureC).toBeNull();
  });

  // A period and a bearing describe the shape of a sea nobody can feel unless
  // there is a height to go with them, so the whole reading drops.
  it("returns no sea state at all when the wave height is missing", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hourly: {
            time: [1_784_422_800],
            sea_surface_temperature: [26.4],
            wave_height: [null],
            wave_period: [7],
            wave_direction: [92],
          },
        }),
      ),
    );

    const forecast = await fetchAutomatedMarineForecast(
      { latitude: 25.12, longitude: -80.3 },
      new Date(1_784_422_800_000),
      fetcher,
    );

    expect(forecast?.surface).toBeNull();
    expect(forecast?.waterTemperatureC).toBe(26);
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

  // The whole reason the raw numbers were unreadable: 0.9 m is a different day
  // depending on whether it arrives every four seconds or every eleven.
  it("reads the same height differently by period", () => {
    expect(seaStateReading(sea(1.0, 4))).toBe("rough");
    expect(seaStateReading(sea(1.0, 7))).toBe("choppy");
    expect(seaStateReading(sea(1.0, 12))).toBe("light_chop");
  });

  it("never calls a long-period swell glassy, however small", () => {
    // A groundswell rolling in every twelve seconds is a comfortable ride and
    // is visibly not a mirror — claiming otherwise is the forecast saying
    // something a diver can disprove by looking at the water.
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
