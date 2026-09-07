import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTidePredictions,
  fixtureTidePredictions,
  parseTidePredictions,
} from "./tide-predictions";
import { tideWindowAt } from "./tides";

const NOAA_PAYLOAD = {
  predictions: [
    { t: "2026-07-21 00:52", v: "0.133", type: "L" },
    { t: "2026-07-21 06:45", v: "0.697", type: "H" },
    { t: "2026-07-21 13:19", v: "0.018", type: "L" },
    { t: "2026-07-21 19:31", v: "0.686", type: "H" },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseTidePredictions", () => {
  it("reads NOAA's GMT rows into instants and kinds, sorted", () => {
    const parsed = parseTidePredictions({
      predictions: [NOAA_PAYLOAD.predictions[1], NOAA_PAYLOAD.predictions[0]],
    });
    expect(parsed?.map((turn) => [turn.at.toISOString(), turn.kind, turn.heightMeters])).toEqual([
      ["2026-07-21T00:52:00.000Z", "low", 0.133],
      ["2026-07-21T06:45:00.000Z", "high", 0.697],
    ]);
  });

  it("drops a row it cannot read and refuses a payload with none left", () => {
    expect(
      parseTidePredictions({
        predictions: [{ t: "garbage", v: "1", type: "H" }, NOAA_PAYLOAD.predictions[0]],
      }),
    ).toHaveLength(1);
    expect(
      parseTidePredictions({ predictions: [{ t: "2026-07-21 00:52", type: "X" }] }),
    ).toBeNull();
    expect(parseTidePredictions({ error: { message: "not a valid station" } })).toBeNull();
    expect(parseTidePredictions(null)).toBeNull();
    expect(parseTidePredictions("predictions")).toBeNull();
  });
});

describe("fetchTidePredictions", () => {
  it("asks NOAA for the local day before, three days on, in GMT and metres", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    const turns = await fetchTidePredictions("8723583", "2026-07-21", fetcher);
    expect(turns).toHaveLength(4);
    const url = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(url.hostname).toBe("api.tidesandcurrents.noaa.gov");
    expect(url.searchParams.get("station")).toBe("8723583");
    expect(url.searchParams.get("begin_date")).toBe("20260720");
    expect(url.searchParams.get("range")).toBe("72");
    expect(url.searchParams.get("time_zone")).toBe("gmt");
    expect(url.searchParams.get("units")).toBe("metric");
    expect(url.searchParams.get("interval")).toBe("hilo");
  });

  it("fetches once per station and day, sharing the in-flight request", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(NOAA_PAYLOAD))));
    const [a, b] = await Promise.all([
      fetchTidePredictions("8723583", "2026-07-21", fetcher),
      fetchTidePredictions("8723583", "2026-07-21", fetcher),
    ]);
    await fetchTidePredictions("8723583", "2026-07-21", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    await fetchTidePredictions("8723583", "2026-07-22", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("answers null, and does not remember the failure, when NOAA refuses or the fetch throws", async () => {
    const refusing = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(NOAA_PAYLOAD)));
    expect(await fetchTidePredictions("8723583", "2026-07-21", refusing)).toBeNull();
    expect(await fetchTidePredictions("8723583", "2026-07-21", refusing)).toHaveLength(4);
    expect(refusing).toHaveBeenCalledTimes(2);

    const throwing = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await fetchTidePredictions("8723583", "2026-07-21", throwing)).toBeNull();

    const unknownStation = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "The station is not a valid station" } })),
      );
    expect(await fetchTidePredictions("0000000", "2026-07-21", unknownStation)).toBeNull();
  });

  it("serves the deterministic fixture instead of live traffic when external HTTP is disabled", async () => {
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const live = vi.spyOn(globalThis, "fetch");
    const turns = await fetchTidePredictions("8723583", "2026-07-21");
    expect(live).not.toHaveBeenCalled();
    expect(turns).toEqual(fixtureTidePredictions("2026-07-20"));
    // An explicit fetcher still exercises the adapter under the flag.
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    expect(await fetchTidePredictions("8723583", "2026-07-21", fetcher)).toHaveLength(4);
  });
});

describe("fixtureTidePredictions", () => {
  it("is a semidiurnal table that alternates, covers three days, and reads a phase at any hour", () => {
    const turns = fixtureTidePredictions("2026-07-20");
    expect(turns[0]?.kind).toBe("low");
    expect(turns[1]?.kind).toBe("high");
    expect(turns.at(-1)?.at.getTime()).toBeGreaterThan(new Date("2026-07-22T18:00:00Z").getTime());
    expect(turns.at(-1)?.at.getTime()).toBeLessThan(new Date("2026-07-23T00:00:00Z").getTime());
    for (const [index, current] of turns.entries()) {
      const previous = turns[index - 1];
      if (previous) expect(current.kind).not.toBe(previous.kind);
    }
    expect(tideWindowAt(turns, new Date("2026-07-21T13:30:00Z"))).not.toBeNull();
    expect(fixtureTidePredictions("2026-07-20")).toEqual(turns);
  });
});
