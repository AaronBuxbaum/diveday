import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { routeSource } from "./route-source";

const APP = path.join(import.meta.dirname, "..", "app");
const TRIP = path.join(APP, "s", "[shopSlug]", "trips", "[id]");
const read = (...parts: string[]) => readFileSync(path.join(...parts), "utf8");

describe("routeSource", () => {
  it("reads a file beside the route first", () => {
    expect(routeSource(TRIP, "page.tsx")).toBe(read(TRIP, "page.tsx"));
    expect(routeSource(TRIP, "_lib/page-reads.ts")).toBe(read(TRIP, "_lib", "page-reads.ts"));
  });

  it("then the route's _components", () => {
    expect(routeSource(TRIP, "TripHero.tsx")).toBe(read(TRIP, "_components", "TripHero.tsx"));
  });

  it("then src/components, however deep the route is", () => {
    const shared = read(APP, "..", "components", "SubmitButton.tsx");
    expect(routeSource(TRIP, "SubmitButton.tsx")).toBe(shared);
    expect(routeSource(path.join(APP, "waivers", "[token]"), "SubmitButton.tsx")).toBe(shared);
  });

  it("takes a test's import.meta.url as well as its directory", () => {
    const url = pathToFileURL(path.join(TRIP, "page.composition.test.ts")).href;
    expect(routeSource(url, "page.tsx")).toBe(read(TRIP, "page.tsx"));
  });

  it("names every place it looked when the file is nowhere", () => {
    expect(() => routeSource(TRIP, "NoSuchSection.tsx")).toThrow(
      /NoSuchSection\.tsx is in none of: .*_components.*components/,
    );
  });
});
