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

  it("prices each Haiku 5.5 token kind at its list price, up to 100K prompt tokens", () => {
    const tenth = million / 10;
    const usage = {
      inputTokens: tenth,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    expect(costMicroUsd("claude-haiku-5-5", usage)).toBe(10_000); // $0.10/M
    expect(
      costMicroUsd("claude-haiku-5-5", { ...usage, inputTokens: 0, cacheReadTokens: tenth }),
    ).toBe(1_000); // $0.01/M
    expect(
      costMicroUsd("claude-haiku-5-5", { ...usage, inputTokens: 0, outputTokens: million }),
    ).toBe(500_000); // $0.50/M
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

  it("prices a Haiku 5.5 prompt over 100K tokens at the long-prompt rate, five times the short one", () => {
    const long = {
      inputTokens: 60_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 50_000,
      outputTokens: 1_000,
    };
    // 60K × $0.50/M + 50K × $0.05/M + 1K × $2.50/M
    expect(costMicroUsd("claude-haiku-5-5", long)).toBe(30_000 + 2_500 + 2_500);
    // At the line it is still the short rate.
    expect(
      costMicroUsd("claude-haiku-5-5", { ...long, inputTokens: 50_000, cacheReadTokens: 50_000 }),
    ).toBe(5_000 + 500 + 500);
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
