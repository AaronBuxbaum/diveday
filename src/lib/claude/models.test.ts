import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS, costMicroUsd, MODEL_PRICES_MICRO_USD_PER_TOKEN } from "./models";

describe("the two models an assist may name", () => {
  it("are Haiku 5.5 for sorting and extraction and Sonnet 5.5 for drafting", () => {
    expect(CLAUDE_MODELS).toEqual({ quick: "claude-haiku-5-5", draft: "claude-sonnet-5-5" });
  });

  it("each carry a price", () => {
    for (const model of Object.values(CLAUDE_MODELS)) {
      expect(MODEL_PRICES_MICRO_USD_PER_TOKEN[model]).toBeDefined();
    }
  });
});

describe("costMicroUsd", () => {
  const million = 1_000_000;

  it("prices a million of each Haiku 5.5 token kind at its list price", () => {
    const usage = {
      inputTokens: million,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    expect(costMicroUsd("claude-haiku-5-5", usage)).toBe(100_000); // $0.10
    expect(
      costMicroUsd("claude-haiku-5-5", { ...usage, inputTokens: 0, cacheReadTokens: million }),
    ).toBe(10_000); // $0.01
    expect(
      costMicroUsd("claude-haiku-5-5", { ...usage, inputTokens: 0, outputTokens: million }),
    ).toBe(500_000); // $0.50
  });

  it("prices a million of each Sonnet 5.5 token kind at its list price", () => {
    const usage = {
      inputTokens: million,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    expect(costMicroUsd("claude-sonnet-5-5", usage)).toBe(2_000_000); // $2
    expect(
      costMicroUsd("claude-sonnet-5-5", { ...usage, inputTokens: 0, cacheReadTokens: million }),
    ).toBe(200_000); // $0.20
    expect(
      costMicroUsd("claude-sonnet-5-5", { ...usage, inputTokens: 0, outputTokens: million }),
    ).toBe(10_000_000); // $10
  });

  it("prices a cache write at 1.25 times fresh input", () => {
    const usage = {
      inputTokens: 0,
      cacheWriteTokens: million,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    expect(costMicroUsd("claude-sonnet-5-5", usage)).toBe(2_500_000);
  });

  it("adds the kinds together and rounds a fraction of a micro-dollar up", () => {
    // 1 Haiku input token is 0.1 micro-USD: a call never costs nothing.
    expect(
      costMicroUsd("claude-haiku-5-5", {
        inputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(1);
    expect(
      costMicroUsd("claude-sonnet-5-5", {
        inputTokens: 1500,
        cacheWriteTokens: 0,
        cacheReadTokens: 3000,
        outputTokens: 400,
      }),
    ).toBe(3000 + 600 + 4000);
  });

  it("treats a negative or non-finite count as zero, never as a credit", () => {
    expect(
      costMicroUsd("claude-sonnet-5-5", {
        inputTokens: -500,
        cacheWriteTokens: Number.NaN,
        cacheReadTokens: Number.POSITIVE_INFINITY,
        outputTokens: 0,
      }),
    ).toBe(0);
  });
});
