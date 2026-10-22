import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import type { ClaudeRequest } from "./provider";
import { buildStructuredRequest, callStructured, type StructuredCall } from "./structured";

const Tag = z.object({
  tag: z.enum(["cancel", "move", "question", "other"]),
  confidence: z.number().min(0).max(1),
});

const call: StructuredCall<typeof Tag> = {
  model: "quick",
  system: "Sort the message.",
  context: "Shop: Blue Reef Divers.",
  content: "Can I move my Saturday dive to Sunday?",
  schema: Tag,
  confidence: (value) => value.confidence,
};

describe("buildStructuredRequest", () => {
  it("names the role's model and asks for JSON in the schema's shape", () => {
    const request = buildStructuredRequest(call);
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect(request.output_config?.format?.schema).toMatchObject({
      type: "object",
      required: ["tag", "confidence"],
    });
    // The SDK's parse helper is not sent over the wire.
    expect(request.output_config?.format).not.toHaveProperty("parse");
  });

  it("puts the stable instructions and shop context first, cached, and the message last", () => {
    const request = buildStructuredRequest(call);
    expect(request.system).toEqual([
      { type: "text", text: "Sort the message." },
      { type: "text", text: "Shop: Blue Reef Divers.", cache_control: { type: "ephemeral" } },
    ]);
    expect(request.messages).toEqual([
      { role: "user", content: "Can I move my Saturday dive to Sunday?" },
    ]);
  });

  it("caches the instructions themselves when there is no shop context", () => {
    const request = buildStructuredRequest({ ...call, context: undefined });
    expect(request.system).toEqual([
      { type: "text", text: "Sort the message.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("runs the quick model at low effort and the drafting model at medium unless told", () => {
    expect(buildStructuredRequest(call).output_config?.effort).toBe("low");
    expect(buildStructuredRequest({ ...call, model: "draft" }).output_config?.effort).toBe(
      "medium",
    );
    expect(buildStructuredRequest({ ...call, effort: "high" }).output_config?.effort).toBe("high");
  });
});

describe("callStructured", () => {
  it("returns the validated value, the usage and what it cost", async () => {
    const provider = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({ tag: "move", confidence: 0.9 }),
          usage: { input_tokens: 800, cache_read_input_tokens: 1500, output_tokens: 80 },
        }),
    });
    const result = await callStructured(provider, call);
    expect(result).toEqual({
      value: { tag: "move", confidence: 0.9 },
      outcome: "ok",
      model: "claude-haiku-5-5",
      usage: { inputTokens: 800, cacheWriteTokens: 0, cacheReadTokens: 1500, outputTokens: 80 },
      costMicroUsd: 80 + 15 + 40,
    });
  });

  it("is null on a refusal, and still counts what the call cost", async () => {
    const provider = fakeClaude({
      reply: () => fakeClaudeMessage({ text: "", stopReason: "refusal" }),
    });
    const result = await callStructured(provider, call);
    expect(result.value).toBeNull();
    expect(result.outcome).toBe("refused");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("is null when the answer was cut off at max_tokens", async () => {
    const provider = fakeClaude({
      reply: () => fakeClaudeMessage({ text: '{"tag":"mo', stopReason: "max_tokens" }),
    });
    expect(await callStructured(provider, call)).toMatchObject({
      value: null,
      outcome: "truncated",
    });
  });

  it("is null when the JSON does not parse or does not match the schema", async () => {
    for (const text of ["not json", '{"tag":"teleport","confidence":0.9}', "{}"]) {
      const provider = fakeClaude({ reply: () => fakeClaudeMessage({ text }) });
      expect(await callStructured(provider, call), text).toMatchObject({
        value: null,
        outcome: "invalid",
      });
    }
  });

  it("is null below the confidence floor", async () => {
    const provider = fakeClaude({
      reply: () => fakeClaudeMessage({ text: JSON.stringify({ tag: "cancel", confidence: 0.4 }) }),
    });
    expect(await callStructured(provider, call)).toMatchObject({
      value: null,
      outcome: "low_confidence",
    });
    expect(await callStructured(provider, { ...call, minConfidence: 0.3 })).toMatchObject({
      value: { tag: "cancel" },
      outcome: "ok",
    });
  });

  it("is null, never a throw, when the provider fails", async () => {
    const provider = fakeClaude({
      reply: () => {
        throw new Error("socket hang up: Can I move my Saturday dive");
      },
    });
    const result = await callStructured(provider, call);
    expect(result).toMatchObject({ value: null, outcome: "error", errorCode: "unknown" });
    expect(result.costMicroUsd).toBe(0);
  });

  it("resumes a paused server-tool turn and adds up every request's usage", async () => {
    const requests: ClaudeRequest[] = [];
    let turn = 0;
    const provider = fakeClaude({
      reply: (request) => {
        requests.push(request);
        turn += 1;
        return turn === 1
          ? fakeClaudeMessage({ text: "Reading the site.", stopReason: "pause_turn" })
          : fakeClaudeMessage({ text: JSON.stringify({ tag: "question", confidence: 1 }) });
      },
    });
    const result = await callStructured(provider, call);
    expect(result.value).toEqual({ tag: "question", confidence: 1 });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.role).toBe("assistant");
    expect(result.usage.inputTokens).toBe(2 * 10);
  });

  it("gives up on a turn that keeps pausing", async () => {
    const provider = fakeClaude({
      reply: () => fakeClaudeMessage({ text: "Still reading.", stopReason: "pause_turn" }),
    });
    expect(await callStructured(provider, call)).toMatchObject({
      value: null,
      outcome: "truncated",
    });
  });
});
