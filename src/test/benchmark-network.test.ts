import { expect, it } from "vitest";
import { ARRIVAL_MAP_PROBES, MAP_REACHABILITY_PROBES } from "@/lib/maps";
import { measurementNetworkPolicy } from "../../benchmarks/network-policy";

const origin = "http://127.0.0.1:3100";

it("continues only the exact isolated worker origin", () => {
  expect(measurementNetworkPolicy(`${origin}/_next/static/chunk.js`, origin)).toBe("continue");
  expect(measurementNetworkPolicy("http://127.0.0.1:3101/api/test/reset", origin)).toBe("abort");
  expect(measurementNetworkPolicy("https://example.com/chunk.js", origin)).toBe("abort");
  expect(measurementNetworkPolicy("invalid", origin)).toBe("abort");
});

it("serves the same inert external map/font fixtures without allowing live dependencies", () => {
  expect(measurementNetworkPolicy("https://fonts.googleapis.com/css?family=Outfit", origin)).toBe(
    "stylesheet",
  );
  expect(measurementNetworkPolicy("https://fonts.gstatic.com/font.woff2", origin)).toBe("abort");
  expect(
    measurementNetworkPolicy(
      "https://www.openstreetmap.org/export/embed.html?layer=mapnik",
      origin,
    ),
  ).toBe("frame");
  expect(
    measurementNetworkPolicy(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/1",
      origin,
    ),
  ).toBe("tile");
  expect(measurementNetworkPolicy("https://server.arcgisonline.com/health", origin)).toBe("abort");
  expect(
    measurementNetworkPolicy("https://server.arcgisonline.com.evil.test/tile/2/1/1", origin),
  ).toBe("abort");
});

it("keeps reachability probes refused even when they are otherwise matching tiles", () => {
  for (const probe of [...MAP_REACHABILITY_PROBES, ...ARRIVAL_MAP_PROBES])
    expect(measurementNetworkPolicy(probe, origin)).toBe("abort");
});
