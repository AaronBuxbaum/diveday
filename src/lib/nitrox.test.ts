import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PPO2_BAR,
  isValidNitroxMix,
  maxOperatingDepthMeters,
  NITROX_MAX_O2_PERCENT,
  NITROX_MIN_O2_PERCENT,
  nitroxMixLabel,
  ppO2BarToCentibar,
  ppO2CentibarToBar,
} from "./nitrox";

describe("isValidNitroxMix", () => {
  it("accepts whole percentages inside the recreational band", () => {
    expect(isValidNitroxMix(NITROX_MIN_O2_PERCENT)).toBe(true);
    expect(isValidNitroxMix(32)).toBe(true);
    expect(isValidNitroxMix(NITROX_MAX_O2_PERCENT)).toBe(true);
  });

  it("rejects mixes outside the band, air, and non-integers (fail closed)", () => {
    expect(isValidNitroxMix(21)).toBe(false); // air
    expect(isValidNitroxMix(41)).toBe(false); // technical
    expect(isValidNitroxMix(32.5)).toBe(false); // not whole percent
    expect(isValidNitroxMix(Number.NaN)).toBe(false);
    expect(isValidNitroxMix(0)).toBe(false);
  });
});

describe("maxOperatingDepthMeters", () => {
  it("derives the conventional MOD at ppO2 1.4", () => {
    // EAN32 → ~33.75 m → floored 33; EAN36 → ~28.9 m → 28.
    expect(maxOperatingDepthMeters(32)).toBe(33);
    expect(maxOperatingDepthMeters(36)).toBe(28);
    expect(maxOperatingDepthMeters(28)).toBe(40);
  });

  it("respects a different ppO2 ceiling", () => {
    // EAN32 at ppO2 1.6 → 10*(1.6/0.32 - 1) = 40 m.
    expect(maxOperatingDepthMeters(32, 1.6)).toBe(40);
  });

  it("throws rather than returning a depth for an invalid mix", () => {
    expect(() => maxOperatingDepthMeters(21)).toThrow();
    expect(() => maxOperatingDepthMeters(50)).toThrow();
  });

  it("uses 1.4 bar as the default ceiling", () => {
    expect(maxOperatingDepthMeters(32, DEFAULT_MAX_PPO2_BAR)).toBe(maxOperatingDepthMeters(32));
  });
});

describe("ppO2 conversions and labels", () => {
  it("round-trips bar and centibar", () => {
    expect(ppO2BarToCentibar(1.4)).toBe(140);
    expect(ppO2CentibarToBar(140)).toBe(1.4);
    expect(ppO2BarToCentibar(1.6)).toBe(160);
  });

  it("labels a mix in EANx form", () => {
    expect(nitroxMixLabel(32)).toBe("EAN32");
  });
});
