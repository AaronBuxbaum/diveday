import { describe, expect, it } from "vitest";
import { externalHttpBlocked } from "./seam";

describe("externalHttpBlocked", () => {
  const off = { DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" };

  it("blocks the real fetch when the fleet switched external HTTP off", () => {
    expect(externalHttpBlocked(off, fetch)).toBe(true);
  });

  it("never blocks a fetch a test injected, so adapters stay testable", () => {
    expect(externalHttpBlocked(off, async () => new Response("{}"))).toBe(false);
  });

  it("blocks only against the seam's own default when it is not fetch", () => {
    const real = () => "real";
    expect(externalHttpBlocked(off, real, real)).toBe(true);
    expect(externalHttpBlocked(off, () => "injected", real)).toBe(false);
  });

  it("is open unless the flag is exactly 1", () => {
    expect(externalHttpBlocked({}, fetch)).toBe(false);
    expect(externalHttpBlocked({ DIVEDAY_DISABLE_EXTERNAL_HTTP: "0" }, fetch)).toBe(false);
    expect(externalHttpBlocked({ DIVEDAY_DISABLE_EXTERNAL_HTTP: "true" }, fetch)).toBe(false);
  });
});
