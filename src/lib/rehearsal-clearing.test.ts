import { describe, expect, it } from "vitest";
import { DAY_MS } from "./clock";
import { FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS } from "./fly-safe";
import { rehearsalMayClear } from "./rehearsal-clearing";

// The nightly cron's tick: 03:15 UTC, whatever the shop's zone.
const tick = (iso: string) => new Date(`${iso}T03:15:00Z`);

describe("rehearsalMayClear", () => {
  it("keeps a rehearsal that ended before the tick but may still be out", () => {
    // Brisbane (UTC+10): a boat due home at noon local is 02:00Z; the 03:15Z
    // tick is 13:15 the same afternoon, and boats run late.
    const endsAt = new Date("2031-05-10T02:00:00Z");
    expect(rehearsalMayClear(endsAt, tick("2031-05-10"), "Australia/Brisbane")).toBe(false);
  });

  it("keeps a rehearsal a later departure's fly-safe still reads", () => {
    // Saturday's rehearsal in New York; Sunday's real boat counts it as a
    // second day, so the tick between them must leave it.
    const endsAt = new Date("2031-05-10T17:00:00Z");
    expect(rehearsalMayClear(endsAt, tick("2031-05-11"), "America/New_York")).toBe(false);
    expect(rehearsalMayClear(endsAt, tick("2031-05-12"), "America/New_York")).toBe(false);
  });

  it("clears once the fly-safe look-back and a full local night have both passed", () => {
    const endsAt = new Date("2031-05-10T17:00:00Z");
    const settled = new Date(endsAt.getTime() + (FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS + 1) * DAY_MS);
    expect(rehearsalMayClear(endsAt, new Date(settled.getTime() - 1), "America/New_York")).toBe(
      false,
    );
    expect(rehearsalMayClear(endsAt, settled, "America/New_York")).toBe(true);
    expect(rehearsalMayClear(endsAt, tick("2031-05-14"), "America/New_York")).toBe(true);
  });
});
