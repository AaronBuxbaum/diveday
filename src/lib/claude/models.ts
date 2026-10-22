/**
 * The two Claude models an assist may name, and what each token costs
 * (ADR 20261018-claude-assists).
 *
 * `quick` is Haiku 5.5: sorting, tagging, extraction and short text. `draft` is
 * Sonnet 5.5: replies, onboarding, translation of long copy and the vision
 * fallback. A feature picks the role, not a model id, so moving a role to a
 * newer model is one line here.
 */
export const CLAUDE_MODELS = {
  quick: "claude-haiku-5-5",
  draft: "claude-sonnet-5-5",
} as const;

export type ClaudeModelRole = keyof typeof CLAUDE_MODELS;
export type ClaudeModel = (typeof CLAUDE_MODELS)[ClaudeModelRole];

/** Every token count a response's `usage` carries that the bill depends on. */
export type TokenUsage = {
  /** Fresh, uncached input. */
  readonly inputTokens: number;
  /** Input written to the prompt cache on this call. */
  readonly cacheWriteTokens: number;
  /** Input served from the prompt cache. */
  readonly cacheReadTokens: number;
  /** Output, thinking included. */
  readonly outputTokens: number;
};

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

/**
 * List prices in micro-USD per token, which is the same number as USD per
 * million tokens. Anthropic first-party rates as of 2026-10; a cache write
 * (five-minute TTL) is 1.25 times fresh input. Haiku 5.5's long-prompt rate
 * (over 100K tokens) is not modelled: no assist sends a prompt that long.
 */
export const MODEL_PRICES_MICRO_USD_PER_TOKEN: Readonly<
  Record<
    ClaudeModel,
    {
      readonly input: number;
      readonly cacheWrite: number;
      readonly cacheRead: number;
      readonly output: number;
    }
  >
> = {
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
};

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * What a call cost, in whole micro-USD, rounded up so a call is never free.
 * A count that is negative or not a number is read as zero, never a credit.
 */
export function costMicroUsd(model: ClaudeModel, usage: TokenUsage): number {
  const price = MODEL_PRICES_MICRO_USD_PER_TOKEN[model];
  const total =
    count(usage.inputTokens) * price.input +
    count(usage.cacheWriteTokens) * price.cacheWrite +
    count(usage.cacheReadTokens) * price.cacheRead +
    count(usage.outputTokens) * price.output;
  // Floating-point products like 0.1 * 3 land a hair above the true value;
  // trimming at a millionth of a micro-dollar keeps an exact price exact.
  return Math.ceil(Math.round(total * 1e6) / 1e6);
}

/** Adds two calls' usage, for a turn that took more than one request. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
