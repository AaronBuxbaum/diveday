import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import { demoStageRecordedAt } from "./seed-trip-stage";

describe("demoStageRecordedAt", () => {
  const startsAt = new Date("2026-07-21T13:00:00.000Z");

  it("stamps the tap twenty minutes after the lines came off", () => {
    const now = new Date("2026-07-21T14:30:00.000Z");
    expect(demoStageRecordedAt(startsAt, now).toISOString()).toBe("2026-07-21T13:20:00.000Z");
  });

  it("never stamps a tap in the future", () => {
    // Regression: a boat ten minutes out got a tap stamped at startsAt + 20m,
    // which `liveShopStage` refuses for being later than the read's own
    // instant — so the demo's chip, storefront panel and diver line were all
    // blank for the first twenty minutes of every departure.
    const now = new Date("2026-07-21T13:10:00.000Z");
    expect(demoStageRecordedAt(startsAt, now).getTime()).toBe(now.getTime());
  });

  it("clamps to this instant on the exact minute the boat leaves", () => {
    expect(demoStageRecordedAt(startsAt, startsAt).getTime()).toBe(startsAt.getTime());
  });

  it("stops clamping the moment twenty minutes have passed", () => {
    const now = new Date(startsAt.getTime() + 20 * MINUTE_MS);
    expect(demoStageRecordedAt(startsAt, now).getTime()).toBe(now.getTime());
    const later = new Date(startsAt.getTime() + 20 * MINUTE_MS + 1);
    expect(demoStageRecordedAt(startsAt, later).getTime()).toBe(
      startsAt.getTime() + 20 * MINUTE_MS,
    );
  });
});
