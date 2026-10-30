import { afterEach, describe, expect, it, vi } from "vitest";
import { signScheduleMoveResult, verifyScheduleMoveResult } from "./schedule-move-result";

const shopId = "b22e9ed4-d836-47a0-a019-a88ac462a488";
const moveId = "6b9de0d1-80c3-4245-b5d1-a57c2f9f74b3";

describe("schedule move result token", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("authenticates the move, shop, gear count, and freshness", () => {
    vi.stubEnv("DIVEDAY_CLOCK", "");
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const token = signScheduleMoveResult(shopId, moveId, 5);
    expect(verifyScheduleMoveResult(token, shopId)).toEqual({ id: moveId, gearReleased: 5 });
    expect(verifyScheduleMoveResult(token, "f04f4175-d8b0-4f02-a2a3-c2e05f496345")).toBeNull();
    expect(verifyScheduleMoveResult(`${token.slice(0, -1)}x`, shopId)).toBeNull();
    expect(verifyScheduleMoveResult("anything", shopId)).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_121_000);
    expect(verifyScheduleMoveResult(token, shopId)).toBeNull();
  });
});
