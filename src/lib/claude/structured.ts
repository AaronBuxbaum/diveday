import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  addUsage,
  CLAUDE_MODELS,
  type ClaudeModel,
  type ClaudeModelRole,
  costMicroUsd,
  type TokenUsage,
  ZERO_USAGE,
} from "./models";
import {
  CLAUDE_REQUEST_MAX_MS,
  type ClaudeMessage,
  type ClaudeProvider,
  type ClaudeRequest,
  claudeErrorCode,
} from "./provider";

/**
 * **One structured-JSON call** (ADR 20261018-claude-assists): the stable
 * instructions and shop context first and cached, the volatile message last,
 * an answer constrained to a zod schema by `output_config.format` and then
 * validated again with the same schema before anything reads it.
 *
 * Every way the call can fail returns `value: null`, never a throw: a refusal,
 * a cut-off answer, JSON that does not match, a confidence under the floor, a
 * provider error. `outcome` says which, as a code, for the usage row.
 */
export type StructuredCall<S extends z.ZodType> = {
  readonly model: ClaudeModelRole;
  /** Fixed instructions for this feature. Never interpolate per-request data here. */
  readonly system: string;
  /** Stable shop context (policies, schedule summary). Cached; changes rarely. */
  readonly context?: string;
  /** The per-request part: a message, sample rows, an image. Last, uncached. */
  readonly content: string | Anthropic.ContentBlockParam[];
  readonly schema: S;
  readonly maxTokens?: number;
  readonly effort?: "low" | "medium" | "high";
  /** Server tools, such as `webFetchTool(...)`. */
  readonly tools?: Anthropic.ToolUnion[];
  /** Reads the model's own 0–1 confidence off the value, when the schema carries one. */
  readonly confidence?: (value: z.infer<S>) => number;
  /** Below this the value is dropped. Defaults to 0.6. */
  readonly minConfidence?: number;
  /**
   * The prompt's likely size in tokens, when it is far from the usual (a PDF):
   * what the cap reserves before the call is sent. Never sent to the API.
   */
  readonly inputTokens?: number;
};

export const STRUCTURED_OUTCOMES = [
  "ok",
  "refused",
  "truncated",
  "invalid",
  "low_confidence",
  "error",
] as const;
export type StructuredOutcome = (typeof STRUCTURED_OUTCOMES)[number];

export type StructuredResult<T> = {
  readonly value: T | null;
  readonly outcome: StructuredOutcome;
  readonly model: ClaudeModel;
  readonly usage: TokenUsage;
  readonly costMicroUsd: number;
  /** For `error` only: `http_429`, `timeout`, … never a message. */
  readonly errorCode?: string;
};

const DEFAULT_MAX_TOKENS = 8_000;
const DEFAULT_MIN_CONFIDENCE = 0.6;
/** Server-tool turns a call may resume before it is treated as cut off. */
const MAX_CONTINUATIONS = 3;

/** The longest one structured call can run: every turn it may resume, each at the request's longest. */
export const CLAUDE_CALL_MAX_MS = CLAUDE_REQUEST_MAX_MS * (MAX_CONTINUATIONS + 1);

const CACHED = { type: "ephemeral" } as const;

/** The request a structured call sends. Exported for tests and for the Batch API later. */
export function buildStructuredRequest<S extends z.ZodType>(
  call: StructuredCall<S>,
): ClaudeRequest {
  const { parse: _parse, ...format } = zodOutputFormat(call.schema);
  const system: Anthropic.TextBlockParam[] = call.context
    ? [
        { type: "text", text: call.system },
        { type: "text", text: call.context, cache_control: CACHED },
      ]
    : [{ type: "text", text: call.system, cache_control: CACHED }];
  return {
    model: CLAUDE_MODELS[call.model],
    max_tokens: call.maxTokens ?? DEFAULT_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: call.content }],
    output_config: {
      format,
      effort: call.effort ?? (call.model === "quick" ? "low" : "medium"),
    },
    ...(call.tools ? { tools: call.tools } : {}),
  };
}

/** The token counts on one response, with absent fields as zero. */
export function usageOf(message: ClaudeMessage): TokenUsage {
  const usage = message.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

function finalText(message: ClaudeMessage): string | null {
  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const block = message.content[index];
    if (block?.type === "text") return block.text;
  }
  return null;
}

function readValue<S extends z.ZodType>(
  message: ClaudeMessage,
  call: StructuredCall<S>,
): { value: z.infer<S> | null; outcome: StructuredOutcome } {
  if (message.stop_reason === "refusal") return { value: null, outcome: "refused" };
  if (message.stop_reason !== "end_turn") return { value: null, outcome: "truncated" };
  const text = finalText(message);
  if (text === null) return { value: null, outcome: "invalid" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { value: null, outcome: "invalid" };
  }
  const parsed = call.schema.safeParse(json);
  if (!parsed.success) return { value: null, outcome: "invalid" };
  if (call.confidence) {
    const confidence = call.confidence(parsed.data);
    const floor = call.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    if (!Number.isFinite(confidence) || confidence < floor) {
      return { value: null, outcome: "low_confidence" };
    }
  }
  return { value: parsed.data, outcome: "ok" };
}

/** Sends one structured call, resuming paused server-tool turns. Never throws. */
export async function callStructured<S extends z.ZodType>(
  provider: ClaudeProvider,
  call: StructuredCall<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const model = CLAUDE_MODELS[call.model];
  const request = buildStructuredRequest(call);
  let usage = ZERO_USAGE;
  const done = (
    value: z.infer<S> | null,
    outcome: StructuredOutcome,
    errorCode?: string,
  ): StructuredResult<z.infer<S>> => ({
    value,
    outcome,
    model,
    usage,
    costMicroUsd: costMicroUsd(model, usage),
    ...(errorCode ? { errorCode } : {}),
  });

  try {
    let messages = request.messages;
    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
      const message = await provider.createMessage({ ...request, messages });
      usage = addUsage(usage, usageOf(message));
      if (message.stop_reason !== "pause_turn") {
        const { value, outcome } = readValue(message, call);
        return done(value, outcome);
      }
      // A long server-tool turn pauses; sending the paused turn back resumes it.
      messages = [
        ...messages,
        { role: "assistant", content: message.content as Anthropic.ContentBlockParam[] },
      ];
    }
    return done(null, "truncated");
  } catch (error) {
    return done(null, "error", claudeErrorCode(error));
  }
}
