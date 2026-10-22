import { describe, expect, it } from "vitest";
import { readAnthropicSpend } from "./anthropic";

const now = new Date("2026-10-18T09:07:00.000Z");
const env = { ANTHROPIC_API_KEY: "test-anthropic-key" };

describe("readAnthropicSpend", () => {
  it("is not_configured without a key", async () => {
    expect(await readAnthropicSpend({ env: {}, now, readSpendUsd: async () => 5 })).toEqual({
      status: "not_configured",
    });
  });

  it("reads this UTC month from the ledger", async () => {
    let window: [Date, Date] | undefined;
    const sample = await readAnthropicSpend({
      env,
      now,
      readSpendUsd: async (start, end) => {
        window = [start, end];
        return 42.5;
      },
    });
    expect(sample).toEqual({ status: "measured", value: 42.5 });
    expect(window?.map((instant) => instant.toISOString())).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
    ]);
  });

  it("is unavailable, never zero, when the ledger cannot be read", async () => {
    expect(await readAnthropicSpend({ env, now })).toEqual({
      status: "unavailable",
      reason: "no_reader",
    });
    expect(
      await readAnthropicSpend({
        env,
        now,
        readSpendUsd: async () => {
          throw new Error("connection refused");
        },
      }),
    ).toEqual({ status: "unavailable", reason: "ledger_unreadable" });
  });
});
