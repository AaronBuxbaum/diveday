import { describe, expect, it } from "vitest";
import * as waivers from "./waivers";

/**
 * `waivers.ts` is a barrel, so each part of a release's life is pinned beside
 * the module that owns it: `waivers-requests.test.ts`,
 * `waivers-completion.test.ts`, `waivers-templates.test.ts`,
 * `waivers-audit.test.ts`, `waivers-in-person.test.ts`,
 * `waivers-medical.test.ts`, `waivers-trip-status.test.ts` and
 * `waivers-delivery-status.test.ts`, over the helpers in
 * `waivers-test-fixtures.ts`. This file pins only the barrel: every name it
 * publishes is there to import.
 */
describe("the waivers barrel", () => {
  it("publishes a defined value for every name it re-exports", () => {
    const missing = Object.entries(waivers)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
    expect(Object.keys(waivers)).toHaveLength(43);
  });
});
