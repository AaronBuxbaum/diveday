import { describe, expect, it } from "vitest";
import { SAMPLE_PROFILE } from "@/lib/dive-profile-sample";
import { profileStats, thinProfile } from "./dive-profile";

describe("profileStats", () => {
  it("says nothing for a recording with no samples", () => {
    expect(profileStats([])).toBeNull();
  });

  it("reads max, time and a time-weighted average", () => {
    const stats = profileStats([
      { seconds: 0, meters: 0 },
      { seconds: 60, meters: 10 },
      { seconds: 360, meters: 10 },
      { seconds: 420, meters: 0 },
    ]);
    expect(stats?.maxMeters).toBe(10);
    expect(stats?.durationSeconds).toBe(420);
    // 5 m for 60 s, 10 m for 300 s, 5 m for 60 s over 420 s
    expect(stats?.averageMeters).toBeCloseTo((300 + 3000 + 300) / 420, 5);
    expect(stats?.safetyStop).toBeNull();
  });

  it("finds a three-minute stop after the deepest point, and only then", () => {
    const stats = profileStats(SAMPLE_PROFILE);
    expect(stats?.safetyStop).not.toBeNull();
    const stop = stats?.safetyStop;
    expect((stop?.toSeconds ?? 0) - (stop?.fromSeconds ?? 0)).toBeGreaterThanOrEqual(150);
    // a shallow dive that sits at 5 m has no safety stop to mark
    const shallow = Array.from({ length: 30 }, (_, i) => ({ seconds: i * 20, meters: 5 }));
    expect(profileStats(shallow)?.safetyStop).toBeNull();
  });
});

describe("thinProfile", () => {
  it("keeps the deepest point and the ends when it thins", () => {
    const samples = Array.from({ length: 5000 }, (_, i) => ({
      seconds: i,
      meters: i === 1234 ? 40 : 10,
    }));
    const thin = thinProfile(samples, 400);
    expect(thin.length).toBeLessThan(1200);
    expect(thin).toContain(samples[1234]);
    expect(thin[0]).toBe(samples[0]);
    expect(thin.at(-1)).toBe(samples.at(-1));
  });
});
