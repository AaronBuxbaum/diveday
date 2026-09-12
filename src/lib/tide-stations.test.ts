import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkStationAgainstSite,
  fetchTideStation,
  fixtureTideStation,
  IMPLAUSIBLE_STATION_DISTANCE_KM,
  parseTideStation,
  stationDistanceInUnit,
  stationDistanceKm,
  stationLabel,
  tideStationEcho,
} from "./tide-stations";

/** NOAA's own `mdapi` record for 8723583, trimmed to the fields the parser reads. */
const NOAA_PAYLOAD = {
  count: 1,
  stations: [
    {
      state: "FL",
      name: "Carysfort Reef",
      lat: 25.2217,
      lng: -80.2117,
      tideType: "Subordinate",
      id: "8723583",
    },
  ],
};

/** The demo's two Key Largo sites and the station that is genuinely nearest them. */
const MOLASSES = { forecastLatitude: 25.0117, forecastLongitude: -80.3764 };
const CARYSFORT = {
  id: "8723583",
  name: "Carysfort Reef",
  state: "FL",
  latitude: 25.2217,
  longitude: -80.2117,
};
/** Vaca Key at Marathon: seven digits, answers the predictions endpoint, and eighty kilometres away. */
const VACA_KEY = {
  id: "8723970",
  name: "Vaca Key",
  state: "FL",
  latitude: 24.7113,
  longitude: -81.1065,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseTideStation", () => {
  it("reads the station's own name, state and position", () => {
    expect(parseTideStation(NOAA_PAYLOAD, "8723583")).toEqual(CARYSFORT);
  });

  it("takes a numeric string position, and an absent state as null", () => {
    const station = parseTideStation(
      { stations: [{ name: "Carysfort Reef", lat: "25.2217", lng: "-80.2117", state: "" }] },
      "8723583",
    );
    expect(station).toEqual({ ...CARYSFORT, state: null });
  });

  it("refuses half a station rather than echoing one back", () => {
    expect(parseTideStation({ stations: [] }, "8723583")).toBeNull();
    expect(parseTideStation({ stations: [{ lat: 25.2217, lng: -80.2117 }] }, "8723583")).toBeNull();
    expect(
      parseTideStation({ stations: [{ name: "  ", lat: 25, lng: -80 }] }, "8723583"),
    ).toBeNull();
    expect(
      parseTideStation(
        { stations: [{ name: "Carysfort Reef", lat: "north", lng: -80.2117 }] },
        "8723583",
      ),
    ).toBeNull();
    expect(parseTideStation({ stations: "8723583" }, "8723583")).toBeNull();
    expect(parseTideStation(null, "8723583")).toBeNull();
    expect(parseTideStation("stations", "8723583")).toBeNull();
  });
});

describe("fetchTideStation", () => {
  it("asks NOAA's station record for the id it was given", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    expect(await fetchTideStation("8723583", fetcher)).toEqual(CARYSFORT);
    const url = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(url.hostname).toBe("api.tidesandcurrents.noaa.gov");
    expect(url.pathname).toBe("/mdapi/prod/webapi/stations/8723583.json");
  });

  it("fetches once per station, sharing the in-flight request", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(NOAA_PAYLOAD))));
    const [a, b] = await Promise.all([
      fetchTideStation("8723583", fetcher),
      fetchTideStation("8723583", fetcher),
    ]);
    await fetchTideStation("8723583", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    await fetchTideStation("8723970", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("answers null when NOAA refuses, the fetch throws, or the body is not a station", async () => {
    expect(
      await fetchTideStation("8723583", vi.fn().mockRejectedValue(new Error("timeout"))),
    ).toBeNull();
    expect(
      await fetchTideStation(
        "8723583",
        vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
      ),
    ).toBeNull();
    expect(
      await fetchTideStation(
        "0000000",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 0, stations: [] }))),
      ),
    ).toBeNull();
  });

  /**
   * A staff page renders this on every visit, so a provider that is down must
   * not cost a fresh four-second timeout per render. Remembered for a minute:
   * a blip costs one render, an outage costs one request a minute.
   */
  it("remembers a failure for a minute, then asks again", async () => {
    // The suite runs on the frozen clock (`DIVEDAY_CLOCK` in vitest.config.ts),
    // which is what `nowMs()` reads, so moving time means restubbing it.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-21T12:00:00.000Z");
    let refuse = true;
    const flaky = vi.fn().mockImplementation(() =>
      // A fresh Response per call: a body reads once.
      Promise.resolve(
        refuse ? new Response("nope", { status: 500 }) : new Response(JSON.stringify(NOAA_PAYLOAD)),
      ),
    );
    expect(await fetchTideStation("8723583", flaky)).toBeNull();
    expect(await fetchTideStation("8723583", flaky)).toBeNull();
    expect(flaky).toHaveBeenCalledTimes(1);

    refuse = false;
    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-21T12:01:01.000Z");
    expect(await fetchTideStation("8723583", flaky)).toEqual(CARYSFORT);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("serves the fixture instead of live traffic when external HTTP is disabled", async () => {
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const live = vi.spyOn(globalThis, "fetch");
    expect(await fetchTideStation("8723583")).toEqual(fixtureTideStation("8723583"));
    expect(live).not.toHaveBeenCalled();
    // An explicit fetcher still exercises the adapter under the flag.
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    expect(await fetchTideStation("8723583", fetcher)).toEqual(CARYSFORT);
  });

  /** `pnpm e2e:build` runs `next build`, so the fleet *is* production by `NODE_ENV`. */
  it("still serves the fixture in an e2e production build, and never in a real one", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const fleet = vi.spyOn(globalThis, "fetch");
    expect(await fetchTideStation("8726520")).toEqual(fixtureTideStation("8726520"));
    expect(fleet).not.toHaveBeenCalled();

    vi.stubEnv("DIVEDAY_E2E", "");
    const live = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    expect(await fetchTideStation("8726607")).toBeNull();
    expect(live).toHaveBeenCalled();
  });
});

describe("fixtureTideStation", () => {
  it("is the same station for every id, and comfortably inside the threshold of the demo's sites", () => {
    expect(fixtureTideStation("8723583")).toEqual(fixtureTideStation("8723583"));
    expect(fixtureTideStation("8723970").name).toBe("Carysfort Reef");
    expect(checkStationAgainstSite(fixtureTideStation("8723583"), MOLASSES).far).toBe(false);
    // The Spiegel Grove, the demo's other stationed site.
    expect(
      checkStationAgainstSite(fixtureTideStation("8723583"), {
        forecastLatitude: 24.9989,
        forecastLongitude: -80.3903,
      }).far,
    ).toBe(false);
  });
});

describe("stationDistanceKm", () => {
  it("measures the Keys to within a kilometre", () => {
    expect(stationDistanceKm(CARYSFORT, { latitude: 25.0117, longitude: -80.3764 })).toBeCloseTo(
      28.6,
      0,
    );
    expect(stationDistanceKm(CARYSFORT, VACA_KEY)).toBeCloseTo(106.6, 0);
    expect(stationDistanceKm(CARYSFORT, CARYSFORT)).toBe(0);
  });
});

describe("stationDistanceInUnit", () => {
  it("reads miles for a shop that reads feet, whole units either way", () => {
    expect(stationDistanceInUnit(80.9, "meters")).toBe(81);
    expect(stationDistanceInUnit(80.9, "feet")).toBe(50);
  });
});

describe("stationLabel", () => {
  it("names the state when NOAA gives one", () => {
    expect(stationLabel(CARYSFORT)).toBe("Carysfort Reef, FL");
    expect(stationLabel({ ...CARYSFORT, state: null })).toBe("Carysfort Reef");
  });
});

describe("checkStationAgainstSite", () => {
  /**
   * The ticket's own worked example (issue #1468): both ids are seven digits,
   * both answer the predictions endpoint, and only one of them is the water
   * this reef is in.
   */
  it("flags Marathon's station on a Key Largo reef and leaves Carysfort alone", () => {
    const wrong = checkStationAgainstSite(VACA_KEY, MOLASSES);
    expect(wrong.far).toBe(true);
    expect(wrong.distanceKm).toBeCloseTo(80.9, 0);

    const right = checkStationAgainstSite(CARYSFORT, MOLASSES);
    expect(right.far).toBe(false);
    expect(right.distanceKm).toBeCloseTo(28.6, 0);
  });

  it("says nothing about a site that has not said where it is", () => {
    expect(
      checkStationAgainstSite(VACA_KEY, { forecastLatitude: null, forecastLongitude: null }),
    ).toEqual({
      distanceKm: null,
      far: false,
    });
    expect(
      checkStationAgainstSite(VACA_KEY, { forecastLatitude: 25.0117, forecastLongitude: null }),
    ).toEqual({
      distanceKm: null,
      far: false,
    });
    expect(checkStationAgainstSite(null, MOLASSES)).toEqual({ distanceKm: null, far: false });
  });

  it("draws the line at the threshold rather than either side of it", () => {
    // A point due north of Carysfort at exactly the threshold is not yet far.
    const atThreshold = {
      forecastLatitude: CARYSFORT.latitude + IMPLAUSIBLE_STATION_DISTANCE_KM / 111.195,
      forecastLongitude: CARYSFORT.longitude,
    };
    expect(checkStationAgainstSite(CARYSFORT, atThreshold).far).toBe(false);
  });
});

describe("tideStationEcho", () => {
  it("carries the station and its verdict together, and nothing at all without a station", () => {
    expect(tideStationEcho(VACA_KEY, MOLASSES)).toMatchObject({ ...VACA_KEY, far: true });
    expect(tideStationEcho(null, MOLASSES)).toBeNull();
  });
});
